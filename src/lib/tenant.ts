import { prisma } from "@/lib/prisma";

export function sessionRole(user: unknown) {
  const role = (user as { role?: unknown })?.role;
  return typeof role === "string" ? role : undefined;
}

export function hasPrismaErrorCode(error: unknown, code: string) {
  return (error as { code?: unknown })?.code === code;
}

export async function canAccessSchool(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((admin) => admin.id === userId);
}

export async function canWriteSchool(schoolId: string, userId: string, role?: string) {
  if (role === "VICE_PRINCIPAL") return false;
  return canAccessSchool(schoolId, userId);
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
