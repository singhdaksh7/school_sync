import { getMobileAuth } from "@/lib/mobile-auth";

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
