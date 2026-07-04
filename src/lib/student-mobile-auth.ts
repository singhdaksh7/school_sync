import { getMobileAuth } from "@/lib/mobile-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { statusIsBlocked } from "@/lib/school-access";

/**
 * Narrows the shared mobile JWT auth (from /api/mobile/student/login) down to a
 * STUDENT context. Returns null for any non-student token so that student-scoped
 * routes never serve staff/teacher/parent tokens.
 *
 * Every value here originates from the signed token (schoolId/studentId) plus a
 * DB lookup constrained to that same schoolId, so callers can safely scope all
 * queries by `schoolId` + `studentId`/`sectionId` with no cross-school exposure.
 */
export async function getStudentMobileAuth(req: Request) {
  const mobile = await getMobileAuth(req);
  if (!mobile || mobile.decoded.role !== "STUDENT" || !("student" in mobile) || !mobile.student) {
    return null;
  }

  return {
    studentId: mobile.student.id,
    schoolId: mobile.decoded.schoolId,
    sectionId: mobile.student.sectionId,
    student: mobile.student,
    school: mobile.school,
  };
}

export type StudentMobileAuth = NonNullable<Awaited<ReturnType<typeof getStudentMobileAuth>>>;

/**
 * Same as getStudentMobileAuth but also accepts a web NextAuth session
 * (cookie-based, role STUDENT) — lets the existing /api/student/* routes
 * serve both the mobile app (bearer token) and the new web student portal
 * (session cookie) without any change to their bearer-token behavior.
 */
export async function getStudentAuth(req: Request) {
  const mobile = await getStudentMobileAuth(req);
  if (mobile) return mobile;

  const session = await auth();
  if (!session?.user?.id || sessionRole(session.user) !== "STUDENT") return null;

  const studentId = (session.user as { studentId?: string }).studentId;
  if (!studentId) return null;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { school: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } } },
  });
  if (!student) return null;
  // A suspended/expired school blocks the web student session too.
  if (statusIsBlocked(student.school.status)) return null;

  return {
    studentId: student.id,
    schoolId: student.schoolId,
    sectionId: student.sectionId,
    student,
    school: student.school,
  };
}
