import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { sessionRole } from "@/lib/tenant";

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
    select: { id: true, name: true, slug: true, logoUrl: true },
  });
  if (!school) return null;

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
      where: { id: decoded.teacherId, schoolId: decoded.schoolId, userId: decoded.userId },
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
  const teacher = await prisma.teacher.findUnique({
    where: { userId: session.user.id },
    select: { id: true, schoolId: true },
  });
  return teacher ? { userId: session.user.id, teacherId: teacher.id, schoolId: teacher.schoolId } : null;
}

export async function authenticateStaffForMobile(email: string, password: string, headers: Headers) {
  const resolvedSchool = await resolveSchool(hostnameFromHeaders(headers));
  const user = await prisma.user.findUnique({
    where: { email },
    include: { ownedSchool: true, school: true },
  });
  if (!user || !STAFF_ROLES.has(user.role)) return null;
  if (!(await bcrypt.compare(password, user.password))) return null;

  if (user.role === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: user.id },
      include: { school: { select: { id: true, name: true, slug: true, logoUrl: true } } },
    });
    if (!teacher) return null;
    if (resolvedSchool && teacher.schoolId !== resolvedSchool.id) return null;
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

export async function authenticateStudentForMobile(identifier: string, password: string, headers: Headers) {
  const resolvedSchool = await resolveSchool(hostnameFromHeaders(headers));
  const trimmed = identifier.trim();
  const students = await prisma.student.findMany({
    where: {
      ...(resolvedSchool ? { schoolId: resolvedSchool.id } : {}),
      OR: [{ admissionNo: trimmed }, { email: trimmed }],
    },
    include: { school: { select: { id: true, name: true, slug: true, logoUrl: true } } },
  });

  const valid = [];
  for (const student of students) {
    if (!student.passwordHash) continue;
    if (await bcrypt.compare(password, student.passwordHash)) valid.push(student);
  }

  if (valid.length !== 1) return null;
  const student = valid[0];
  return {
    role: "STUDENT" as const,
    student: {
      id: student.id,
      name: student.name,
      rollNo: student.rollNo,
      admissionNo: student.admissionNo,
      email: student.email,
      schoolId: student.schoolId,
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
