import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getTeacherPermissions, getTeacherScope, teacherHasAnyRoleAssignment } from "@/lib/teacher-permissions";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Custom-RBAC introspection: this endpoint only surfaces the custom teacher-role
  // permission/scope state, so it belongs to the TEACHER_PERMISSIONS module. When
  // the school has the module off, it returns 403 (no custom RBAC to report). This
  // does NOT affect base teacher access — the teacher's module routes (homework,
  // attendance, ...) are each gated by their own feature key and authorization.
  const featureDenied = await requireSchoolFeature(teacherAuth.schoolId, "TEACHER_PERMISSIONS");
  if (featureDenied) return featureDenied;

  const [permissions, scope, hasCustomRole] = await Promise.all([
    getTeacherPermissions(teacherAuth.teacherId, teacherAuth.schoolId),
    getTeacherScope(teacherAuth.teacherId, teacherAuth.schoolId),
    teacherHasAnyRoleAssignment(teacherAuth.teacherId, teacherAuth.schoolId),
  ]);

  return NextResponse.json({ permissions, scope, hasCustomRole });
}
