import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherScope, teacherHasPermission } from "@/lib/teacher-permissions";

/**
 * Route-level guards for the custom teacher roles & permissions system.
 *
 * DESIGN: enforcement is strictly ADDITIVE.
 * - A teacher with NO custom-role assignments is treated as before — every guard
 *   is a no-op, so existing teacher access is never tightened.
 * - A teacher WITH custom roles must hold the required permission, and (when a
 *   class/section scope is set) may only touch data inside that scope.
 *
 * These guards sit on TOP of existing safety (mentor-section, timetable/subject
 * assignment, schoolId scoping) — they never replace it.
 */

export async function teacherHasCustomRoles(teacherId: string, schoolId: string): Promise<boolean> {
  const count = await prisma.teacherRoleAssignment.count({ where: { teacherId, schoolId } });
  return count > 0;
}

/**
 * Returns `null` when the action is allowed (caller should proceed) or a 403
 * NextResponse when denied. Teachers without custom roles are always allowed.
 * `actions` accepts a single action or a list ("any of").
 */
export async function requireTeacherPermission(
  teacherId: string,
  schoolId: string,
  module: string,
  actions: string | string[]
): Promise<NextResponse | null> {
  if (!(await teacherHasCustomRoles(teacherId, schoolId))) return null;

  const list = Array.isArray(actions) ? actions : [actions];
  for (const action of list) {
    if (await teacherHasPermission(teacherId, schoolId, module, action)) return null;
  }
  return NextResponse.json(
    { error: `Your role does not allow ${module}:${list.join("/")}.` },
    { status: 403 }
  );
}

export type ResolvedTeacherScope = { unrestricted: boolean; sectionIds: Set<string> };

/**
 * Resolves the teacher's effective section scope, expanding any class scope into
 * its section ids. Unrestricted for teachers with no custom roles and for
 * custom-role teachers whose scope is school-wide.
 */
export async function getResolvedTeacherScope(
  teacherId: string,
  schoolId: string
): Promise<ResolvedTeacherScope> {
  if (!(await teacherHasCustomRoles(teacherId, schoolId))) {
    return { unrestricted: true, sectionIds: new Set() };
  }

  const scope = await getTeacherScope(teacherId, schoolId);
  if (scope.unrestricted) return { unrestricted: true, sectionIds: new Set() };

  const sectionIds = new Set(scope.sectionIds);
  if (scope.classIds.length > 0) {
    const sections = await prisma.section.findMany({
      where: { classId: { in: scope.classIds }, class: { schoolId } },
      select: { id: true },
    });
    for (const section of sections) sectionIds.add(section.id);
  }
  return { unrestricted: false, sectionIds };
}

/**
 * Prisma where-fragment restricting a `sectionId` column to the teacher's scope.
 * Returns `{}` (a no-op) when unrestricted, so it is safe to AND into any query.
 */
export function filterTeacherScope(
  scope: ResolvedTeacherScope
): { sectionId: { in: string[] } } | Record<string, never> {
  if (scope.unrestricted) return {};
  return { sectionId: { in: [...scope.sectionIds] } };
}

/** True when the teacher may access the given section under their scope. */
export function assertTeacherScopeAccess(
  scope: ResolvedTeacherScope,
  sectionId: string | null | undefined
): boolean {
  if (scope.unrestricted) return true;
  return Boolean(sectionId && scope.sectionIds.has(sectionId));
}

/** Standard 403 for an out-of-scope record. */
export function scopeForbidden(): NextResponse {
  return NextResponse.json(
    { error: "This record is outside your assigned classes/sections." },
    { status: 403 }
  );
}
