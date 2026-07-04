import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { getActiveTeacherByUserId, sessionRole } from "@/lib/tenant";
import { statusIsBlocked } from "@/lib/school-access";
import { classifyStudentMatches } from "@/lib/student-login";
import { NoAccountError, InvalidPasswordError, AmbiguousSchoolError } from "@/lib/auth-errors";

export type MobileRole = "SCHOOL_OWNER" | "SCHOOL_ADMIN" | "VICE_PRINCIPAL" | "TEACHER" | "STUDENT";

type MobileTokenPayload = {
  type: "mobile";
  role: MobileRole;
  userId?: string;
  teacherId?: string;
  studentId?: string;
  schoolId: string;
  schoolSlug: string;
  name: string;
  email?: string | null;
};

const STAFF_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL", "TEACHER"]);

function jwtSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return secret;
}

export function generateMobileToken(payload: MobileTokenPayload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: "7d" });
}

export function verifyMobileToken(token: string): MobileTokenPayload | null {
  try {
    const decoded = jwt.verify(token, jwtSecret()) as MobileTokenPayload;
    if (decoded.type !== "mobile" || !decoded.role || !decoded.schoolId) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function bearerToken(req: Request) {
  return req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || null;
}

export async function getMobileAuth(req: Request) {
  const token = bearerToken(req);
  if (!token) return null;
  const decoded = verifyMobileToken(token);
  if (!decoded) return null;

  const school = await prisma.school.findFirst({
    where: { id: decoded.schoolId, slug: decoded.schoolSlug },
    select: { id: true, name: true, slug: true, logoUrl: true, status: true },
  });
  if (!school) return null;
  // A live suspension/expiry blocks every mobile role even if the JWT is valid.
  if (statusIsBlocked(school.status)) return null;

  if (decoded.role === "STUDENT") {
    const student = await prisma.student.findFirst({
      where: { id: decoded.studentId, schoolId: decoded.schoolId },
      select: {
        id: true,
        name: true,
        rollNo: true,
        admissionNo: true,
        email: true,
        schoolId: true,
        sectionId: true,
        section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
      },
    });
    return student ? { decoded, school, student } : null;
  }

  if (decoded.role === "TEACHER") {
    const teacher = await prisma.teacher.findFirst({
      where: { id: decoded.teacherId, schoolId: decoded.schoolId, userId: decoded.userId, isDeleted: false },
      select: { id: true, schoolId: true, userId: true, mentorSectionId: true },
    });
    return teacher ? { decoded, school, teacher } : null;
  }

  const user = await prisma.user.findFirst({
    where: { id: decoded.userId, OR: [{ schoolId: decoded.schoolId }, { ownedSchool: { id: decoded.schoolId } }] },
    select: { id: true, name: true, email: true, role: true, schoolId: true },
  });
  return user ? { decoded, school, user } : null;
}

export async function getTeacherAuth(req: Request) {
  const mobile = await getMobileAuth(req);
  if (mobile?.decoded.role === "TEACHER" && "teacher" in mobile && mobile.teacher) {
    return { userId: mobile.decoded.userId, teacherId: mobile.teacher.id, schoolId: mobile.teacher.schoolId };
  }

  const session = await auth();
  if (!session?.user?.id || sessionRole(session.user) !== "TEACHER") return null;
  const teacher = await getActiveTeacherByUserId(session.user.id);
  return teacher ? { userId: session.user.id, teacherId: teacher.id, schoolId: teacher.schoolId } : null;
}

export async function authenticateStaffForMobile(email: string, password: string, headers: Headers) {
  const resolvedSchool = await resolveSchool(hostnameFromHeaders(headers));
  const user = await prisma.user.findUnique({
    where: { email },
    include: { ownedSchool: true, school: true },
  });
  if (!user || !STAFF_ROLES.has(user.role)) throw new NoAccountError();
  if (!(await bcrypt.compare(password, user.password))) throw new InvalidPasswordError();

  if (user.role === "TEACHER") {
    const teacher = await prisma.teacher.findFirst({
      where: { userId: user.id, isDeleted: false },
      include: { school: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } } },
    });
    if (!teacher) return null;
    if (resolvedSchool && teacher.schoolId !== resolvedSchool.id) return null;
    if (statusIsBlocked(teacher.school.status)) return null;
    return {
      role: user.role as MobileRole,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, teacherId: teacher.id, schoolId: teacher.schoolId },
      school: teacher.school,
      tokenPayload: {
        type: "mobile" as const,
        role: user.role as MobileRole,
        userId: user.id,
        teacherId: teacher.id,
        schoolId: teacher.schoolId,
        schoolSlug: teacher.school.slug,
        name: user.name,
        email: user.email,
      },
    };
  }

  const school = user.ownedSchool || user.school;
  if (!school) return null;
  if (resolvedSchool && school.id !== resolvedSchool.id) return null;
  if (statusIsBlocked(school.status)) return null;
  return {
    role: user.role as MobileRole,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, schoolId: school.id },
    school: { id: school.id, name: school.name, slug: school.slug, logoUrl: school.logoUrl },
    tokenPayload: {
      type: "mobile" as const,
      role: user.role as MobileRole,
      userId: user.id,
      schoolId: school.id,
      schoolSlug: school.slug,
      name: user.name,
      email: user.email,
    },
  };
}

/**
 * Verifies a student's password. Precedence:
 *   1. If the student has set a real password (passwordHash), ONLY that is
 *      accepted — the parent phone stops working as a login secret once a real
 *      password exists (so the phone is a default credential, not a permanent one).
 *   2. Otherwise fall back to the father/mother phone hash (the default
 *      first-login credential established at student creation).
 */
async function studentPasswordMatches(
  student: { passwordHash: string | null; fatherPhoneHash: string | null; motherPhoneHash: string | null },
  password: string
): Promise<boolean> {
  if (student.passwordHash) return bcrypt.compare(password, student.passwordHash);
  if (student.fatherPhoneHash && (await bcrypt.compare(password, student.fatherPhoneHash))) return true;
  if (student.motherPhoneHash && (await bcrypt.compare(password, student.motherPhoneHash))) return true;
  return false;
}

export async function authenticateStudentForMobile(
  identifier: string,
  password: string,
  headers: Headers,
  explicitSchool?: { id?: string | null; slug?: string | null }
) {
  const resolvedSchool = await resolveSchool(hostnameFromHeaders(headers));
  // School scope, in priority order: the request's white-label domain, then an
  // explicit school id/slug supplied by the caller. With scope, the
  // @@unique([schoolId, admissionNo]) constraint guarantees at most one match,
  // so siblings/shared-phone families and cross-school admission-number reuse
  // resolve deterministically instead of failing.
  const schoolScope = resolvedSchool
    ? { schoolId: resolvedSchool.id }
    : explicitSchool?.id
      ? { schoolId: explicitSchool.id }
      : explicitSchool?.slug
        ? { school: { slug: explicitSchool.slug } }
        : {};

  const trimmed = identifier.trim();
  const students = await prisma.student.findMany({
    where: { ...schoolScope, admissionNo: trimmed },
    include: { school: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } } },
  });

  if (students.length === 0) throw new NoAccountError();

  const valid = [];
  for (const student of students) {
    if (await studentPasswordMatches(student, password)) valid.push(student);
  }

  if (valid.length === 0) throw new InvalidPasswordError();

  const outcome = classifyStudentMatches(valid);
  // Same admission number authenticated in more than one school and we had no
  // school context to disambiguate — ask the user to use their school's portal.
  if (outcome.status === "ambiguous") throw new AmbiguousSchoolError();
  const student = outcome.student!;

  if (statusIsBlocked(student.school.status)) throw new NoAccountError();

  return {
    role: "STUDENT" as const,
    student: {
      id: student.id,
      name: student.name,
      rollNo: student.rollNo,
      admissionNo: student.admissionNo,
      email: student.email,
      schoolId: student.schoolId,
      sectionId: student.sectionId,
    },
    school: student.school,
    tokenPayload: {
      type: "mobile" as const,
      role: "STUDENT" as const,
      studentId: student.id,
      schoolId: student.schoolId,
      schoolSlug: student.school.slug,
      name: student.name,
      email: student.email,
    },
  };
}
