import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { getTeacherPermissions, getTeacherScope, teacherHasAnyRoleAssignment } from "@/lib/teacher-permissions";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [permissions, scope, hasCustomRole] = await Promise.all([
    getTeacherPermissions(teacherAuth.teacherId, teacherAuth.schoolId),
    getTeacherScope(teacherAuth.teacherId, teacherAuth.schoolId),
    teacherHasAnyRoleAssignment(teacherAuth.teacherId, teacherAuth.schoolId),
  ]);

  return NextResponse.json({ permissions, scope, hasCustomRole });
}
