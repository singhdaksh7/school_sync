import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { schoolLifecycleGate } from "@/lib/school-access";
import {
  getTeacherScope,
  teacherHasAnyRoleAssignment,
  teacherHasPermission,
  type PermissionModule,
  type TeacherScope,
} from "@/lib/teacher-permissions";

type AuthorizeTarget = { sectionId?: string; classId?: string };

export type AuthorizeResult = { allowed: boolean; scope: TeacherScope; reason?: string };

/**
 * Unrestricted-by-default permission + scope check for a teacher action.
 * A teacher with no TeacherRoleAssignment rows keeps full legacy access
 * (see teacher-permissions.ts) — only assigned roles narrow access.
 */
export async function authorizeTeacher(
  teacherId: string,
  schoolId: string,
  module: PermissionModule,
  action: string,
  target?: AuthorizeTarget
): Promise<AuthorizeResult> {
  const scope = await getTeacherScope(teacherId, schoolId);

  if (scope.unrestricted && !(await teacherHasAnyRoleAssignment(teacherId, schoolId))) {
    // No custom roles assigned at all — legacy unrestricted access.
    return { allowed: true, scope };
  }

  const hasPermission = await teacherHasPermission(teacherId, schoolId, module, action);
  if (!hasPermission) return { allowed: false, scope, reason: "MISSING_PERMISSION" };

  // MANAGE_ALL (where it exists in a module's catalog, e.g. HOMEWORK) means
  // the teacher can act outside their assigned class/section scope.
  const hasManageAll = action !== "MANAGE_ALL" && (await teacherHasPermission(teacherId, schoolId, module, "MANAGE_ALL"));

  if (!scope.unrestricted && !hasManageAll && target) {
    const sectionOk = target.sectionId ? scope.sectionIds.includes(target.sectionId) : true;
    const classOk = target.classId ? scope.classIds.includes(target.classId) : true;
    if (!sectionOk || !classOk) return { allowed: false, scope, reason: "OUT_OF_SCOPE" };
  }

  return { allowed: true, scope };
}

function forbidden(reason: string, permission: string) {
  return NextResponse.json({ error: "Forbidden", reason, permission }, { status: 403 });
}

/**
 * For routes currently gated by canAccessSchool() (owner/admin only): keeps
 * that path fully unchanged, and additionally allows a TEACHER holding the
 * matching permission through. VICE_PRINCIPAL is intentionally not included.
 */
export async function requireSchoolAccess(
  schoolId: string,
  userId: string,
  role: string | undefined,
  module: PermissionModule,
  action: string,
  target?: AuthorizeTarget
): Promise<{ ok: true; teacherId: string | null } | { ok: false; response: NextResponse }> {
  // Lifecycle first: a suspended/expired school blocks everyone (owner, admin,
  // and any RBAC-permissioned teacher) before either access path is evaluated.
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return { ok: false, response: blocked };

  if (await canAccessSchool(schoolId, userId)) {
    return { ok: true, teacherId: null };
  }

  if (role !== "TEACHER") {
    return { ok: false, response: forbidden("FORBIDDEN", `${module}:${action}`) };
  }

  // Soft-deleted teachers are never resolved as active — no admin fallback,
  // no scoped RBAC access.
  const teacher = await prisma.teacher.findFirst({
    where: { userId, isDeleted: false },
    select: { id: true, schoolId: true },
  });
  if (!teacher || teacher.schoolId !== schoolId) {
    return { ok: false, response: forbidden("FORBIDDEN", `${module}:${action}`) };
  }

  const result = await authorizeTeacher(teacher.id, schoolId, module, action, target);
  if (!result.allowed) {
    return { ok: false, response: forbidden(result.reason ?? "MISSING_PERMISSION", `${module}:${action}`) };
  }

  return { ok: true, teacherId: teacher.id };
}

/** Convenience for /api/teacher/* routes that already have a teacherId — returns a ready 403 or null. */
export async function requireTeacherPermission(
  teacherId: string,
  schoolId: string,
  module: PermissionModule,
  action: string,
  target?: AuthorizeTarget
): Promise<NextResponse | null> {
  const blocked = await schoolLifecycleGate(schoolId);
  if (blocked) return blocked;

  const result = await authorizeTeacher(teacherId, schoolId, module, action, target);
  if (!result.allowed) return forbidden(result.reason ?? "MISSING_PERMISSION", `${module}:${action}`);
  return null;
}
