import { prisma } from "@/lib/prisma";

/**
 * Custom teacher roles & permissions (additive RBAC).
 *
 * IMPORTANT: This layer is OPT-IN. The base UserRole (including TEACHER) keeps
 * all of its existing access — these helpers only grant/deny where they are
 * explicitly consulted. A teacher with no custom-role assignments is treated as
 * unrestricted by `getTeacherScope` so existing flows are never tightened.
 *
 * All lookups are scoped by `schoolId` (and the role itself must belong to the
 * same school), so a teacher can never read another school's roles/permissions.
 */

export const PERMISSION_CATALOG = {
  STUDENTS: ["VIEW", "CREATE", "UPDATE", "DELETE"],
  ATTENDANCE: ["VIEW", "MARK", "EDIT", "REPORTS"],
  HOMEWORK: ["VIEW", "CREATE", "REVIEW", "MANAGE_ALL"],
  MARKS: ["VIEW", "ENTER", "EDIT", "REPORTS"],
  REPORT_CARDS: ["VIEW", "GENERATE", "PUBLISH", "DOWNLOAD"],
  FEES: ["VIEW", "RECORD_PAYMENT", "DOWNLOAD_RECEIPT"],
  TEACHERS: ["VIEW", "MANAGE_LEAVES", "ASSIGN_SUBSTITUTIONS"],
  ANNOUNCEMENTS: ["VIEW", "CREATE", "MANAGE"],
  SETTINGS: ["VIEW"],
} as const;

export type PermissionModule = keyof typeof PERMISSION_CATALOG;

export type PermissionPair = { module: string; action: string };

export type TeacherScope = {
  /** Distinct class ids across every assignment (empty when unrestricted). */
  classIds: string[];
  /** Distinct section ids across every assignment (empty when unrestricted). */
  sectionIds: string[];
  /**
   * True when the teacher should not be limited by class/section — either they
   * have no custom-role assignments, or at least one assignment is school-wide
   * (no scope arrays set).
   */
  unrestricted: boolean;
};

/** Validates a (module, action) pair against the catalog. */
export function isValidPermission(module: string, action: string): boolean {
  const actions = (PERMISSION_CATALOG as Record<string, readonly string[]>)[module];
  return Boolean(actions && actions.includes(action));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Returns the teacher's effective allowed permissions, merged across every
 * role assigned to them in this school. A grant in any role wins (allowed=true),
 * but an explicit `allowed=false` in every granting role keeps it denied.
 */
export async function getTeacherPermissions(
  teacherId: string,
  schoolId: string
): Promise<PermissionPair[]> {
  const assignments = await prisma.teacherRoleAssignment.findMany({
    where: { teacherId, schoolId, role: { schoolId } },
    include: { role: { include: { permissions: true } } },
  });

  const allowedByKey = new Map<string, boolean>();
  for (const assignment of assignments) {
    for (const permission of assignment.role.permissions) {
      const key = `${permission.module}:${permission.action}`;
      const current = allowedByKey.get(key);
      // Any explicit allow wins; otherwise keep the most permissive seen so far.
      allowedByKey.set(key, current === true ? true : permission.allowed);
    }
  }

  return Array.from(allowedByKey.entries())
    .filter(([, allowed]) => allowed)
    .map(([key]) => {
      const [module, action] = key.split(":");
      return { module, action };
    });
}

/**
 * True when the teacher has at least one role in this school granting the given
 * (module, action). Always scoped to schoolId — no cross-school access.
 */
export async function teacherHasPermission(
  teacherId: string,
  schoolId: string,
  module: string,
  action: string
): Promise<boolean> {
  const assignment = await prisma.teacherRoleAssignment.findFirst({
    where: {
      teacherId,
      schoolId,
      role: {
        schoolId,
        permissions: { some: { module, action, allowed: true } },
      },
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

/**
 * Returns the union of class/section scope across the teacher's assignments.
 * See `TeacherScope.unrestricted` for the default-open semantics that protect
 * existing teacher access.
 */
export async function getTeacherScope(
  teacherId: string,
  schoolId: string
): Promise<TeacherScope> {
  const assignments = await prisma.teacherRoleAssignment.findMany({
    where: { teacherId, schoolId },
    select: { classIds: true, sectionIds: true },
  });

  if (assignments.length === 0) {
    return { classIds: [], sectionIds: [], unrestricted: true };
  }

  const classIds = new Set<string>();
  const sectionIds = new Set<string>();
  let unrestricted = false;

  for (const assignment of assignments) {
    const classes = toStringArray(assignment.classIds);
    const sections = toStringArray(assignment.sectionIds);
    // A role assigned with no scope applies to the whole school.
    if (classes.length === 0 && sections.length === 0) unrestricted = true;
    classes.forEach((id) => classIds.add(id));
    sections.forEach((id) => sectionIds.add(id));
  }

  return { classIds: [...classIds], sectionIds: [...sectionIds], unrestricted };
}
