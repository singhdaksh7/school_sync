import { prisma } from "@/lib/prisma";
import { isSchoolAdminReadRole, statusIsBlocked } from "@/lib/school-access";

export function sessionRole(user: unknown) {
  const role = (user as { role?: unknown })?.role;
  return typeof role === "string" ? role : undefined;
}

export function hasPrismaErrorCode(error: unknown, code: string) {
  return (error as { code?: unknown })?.code === code;
}

/**
 * Generic school-admin READ access. Role-aware: only SCHOOL_OWNER (via
 * ownership) and SCHOOL_ADMIN / VICE_PRINCIPAL (via User.schoolId membership)
 * pass. A TEACHER never passes here even though their User.schoolId is set —
 * closing the invite-driven privilege-escalation path. Teachers must go through
 * requireSchoolAccess / requireTeacherPermission (scoped RBAC) instead.
 *
 * Also enforces the school lifecycle: a SUSPENDED/EXPIRED school denies access
 * regardless of role or a still-valid session. The status is re-read from the
 * DB on every call so a live suspension can't be bypassed by an old JWT.
 */
export async function canAccessSchool(schoolId: string, userId: string) {
  const [school, user] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { ownerId: true, status: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, schoolId: true } }),
  ]);
  if (!school || !user) return false;
  if (statusIsBlocked(school.status)) return false;
  if (!isSchoolAdminReadRole(user.role)) return false;
  if (school.ownerId === userId) return true;
  return user.schoolId === schoolId;
}

export async function canWriteSchool(schoolId: string, userId: string, role?: string) {
  // VICE_PRINCIPAL keeps its existing read-only policy for generic writes.
  if (role === "VICE_PRINCIPAL") return false;
  return canAccessSchool(schoolId, userId);
}

/**
 * Membership check for the billing recovery path only (payment-proof upload).
 * Deliberately status-EXEMPT so a suspended/expired school can still submit the
 * proof that gets it reinstated. Limited to billing-capable roles (owner/admin).
 */
export async function canAccessSchoolForBilling(schoolId: string, userId: string, role?: string) {
  if (role !== "SCHOOL_OWNER" && role !== "SCHOOL_ADMIN") return false;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { ownerId: true } });
  if (!school) return false;
  if (school.ownerId === userId) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { schoolId: true } });
  return user?.schoolId === schoolId;
}

/**
 * Resolves a teacher by their linked userId, excluding soft-deleted teachers.
 * Centralizes the `isDeleted: false` guard so a deactivated teacher can never
 * be resolved as an active teacher anywhere (auth, mobile, homework, reports).
 */
export async function getActiveTeacherByUserId(userId: string) {
  return prisma.teacher.findFirst({
    where: { userId, isDeleted: false },
    select: { id: true, schoolId: true },
  });
}

const INVITABLE_ROLES = ["SCHOOL_ADMIN", "VICE_PRINCIPAL", "TEACHER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: unknown): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role as string);
}

/**
 * Staff-invite permission matrix (re-derives role/ownership from the DB rather
 * than trusting the caller's session, since this gates account creation):
 *   - SCHOOL_OWNER can invite SCHOOL_ADMIN, VICE_PRINCIPAL, or TEACHER.
 *   - SCHOOL_ADMIN can invite VICE_PRINCIPAL or TEACHER, but not another SCHOOL_ADMIN.
 *   - VICE_PRINCIPAL, TEACHER, STUDENT, and anyone outside the school: never.
 */
export async function canInviteRole(schoolId: string, userId: string, targetRole: InvitableRole) {
  const [school, user] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { ownerId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, schoolId: true } }),
  ]);
  if (!school || !user) return false;
  if (school.ownerId === userId) return true;
  if (user.role !== "SCHOOL_ADMIN" || user.schoolId !== schoolId) return false;
  return targetRole !== "SCHOOL_ADMIN";
}

export async function sectionBelongsToSchool(sectionId: string, schoolId: string) {
  const section = await prisma.section.findFirst({
    where: { id: sectionId, class: { schoolId } },
    select: { id: true },
  });
  return Boolean(section);
}

export async function classBelongsToSchool(classId: string, schoolId: string) {
  const cls = await prisma.class.findFirst({
    where: { id: classId, schoolId },
    select: { id: true },
  });
  return Boolean(cls);
}

export async function teacherBelongsToSchool(teacherId: string, schoolId: string) {
  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId, isDeleted: false },
    select: { id: true },
  });
  return Boolean(teacher);
}

export async function studentBelongsToSchool(studentId: string, schoolId: string, sectionId?: string) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId, ...(sectionId ? { sectionId } : {}) },
    select: { id: true },
  });
  return Boolean(student);
}

export async function feeStructureBelongsToSchool(feeStructureId: string, schoolId: string) {
  const feeStructure = await prisma.feeStructure.findFirst({
    where: { id: feeStructureId, schoolId },
    select: { id: true },
  });
  return Boolean(feeStructure);
}

export async function examSchemeBelongsToSchool(schemeId: string, schoolId: string) {
  const scheme = await prisma.examScheme.findFirst({
    where: { id: schemeId, schoolId },
    select: { id: true },
  });
  return Boolean(scheme);
}

export async function getExamInSchool(examId: string, schoolId: string, schemeId?: string) {
  return prisma.exam.findFirst({
    where: {
      id: examId,
      ...(schemeId ? { schemeId } : {}),
      scheme: { schoolId },
    },
    include: { scheme: true },
  });
}

export async function allStudentsBelongToSchool(
  studentIds: string[],
  schoolId: string,
  sectionId?: string
) {
  const uniqueIds = [...new Set(studentIds)];
  if (uniqueIds.length === 0) return true;

  const count = await prisma.student.count({
    where: {
      id: { in: uniqueIds },
      schoolId,
      ...(sectionId ? { sectionId } : {}),
    },
  });
  return count === uniqueIds.length;
}

export async function allTeachersBelongToSchool(teacherIds: string[], schoolId: string) {
  const uniqueIds = [...new Set(teacherIds.filter(Boolean))];
  if (uniqueIds.length === 0) return true;

  const count = await prisma.teacher.count({
    where: { id: { in: uniqueIds }, schoolId, isDeleted: false },
  });
  return count === uniqueIds.length;
}

export async function examMilestoneBelongsToSchool(examMilestoneId: string, schoolId: string) {
  const milestone = await prisma.examMilestone.findFirst({
    where: { id: examMilestoneId, schoolId },
    select: { id: true },
  });
  return Boolean(milestone);
}

export async function notebookCheckBelongsToSchool(notebookCheckId: string, schoolId: string) {
  const check = await prisma.notebookCheck.findFirst({
    where: { id: notebookCheckId, schoolId },
    select: { id: true },
  });
  return Boolean(check);
}

export async function routeBelongsToSchool(routeId: string, schoolId: string) {
  const route = await prisma.route.findFirst({
    where: { id: routeId, schoolId },
    select: { id: true },
  });
  return Boolean(route);
}

export async function vehicleBelongsToSchool(vehicleId: string, schoolId: string) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, schoolId },
    select: { id: true },
  });
  return Boolean(vehicle);
}

export async function driverBelongsToSchool(driverId: string, schoolId: string) {
  const driver = await prisma.driver.findFirst({
    where: { id: driverId, schoolId },
    select: { id: true },
  });
  return Boolean(driver);
}
