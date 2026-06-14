import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, teacherBelongsToSchool } from "@/lib/tenant";
import { getTeacherPermissions, getTeacherScope } from "@/lib/teacher-permissions";

/**
 * Example consumer of the permission helpers. Returns a teacher's effective
 * (merged) permissions and class/section scope. Read-only and does not change
 * how any existing route behaves — it only demonstrates how enforcement will be
 * wired in later phases.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; teacherId: string }> }
) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await teacherBelongsToSchool(teacherId, schoolId)))
    return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const [permissions, scope] = await Promise.all([
    getTeacherPermissions(teacherId, schoolId),
    getTeacherScope(teacherId, schoolId),
  ]);

  return NextResponse.json({ permissions, scope });
}
