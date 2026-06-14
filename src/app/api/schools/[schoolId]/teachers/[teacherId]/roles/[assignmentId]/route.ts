import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole, canWriteSchool } from "@/lib/tenant";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; teacherId: string; assignmentId: string }> }
) {
  const { schoolId, teacherId, assignmentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user))))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Scope the delete to this teacher + school so an id from another tenant can't be removed.
  const assignment = await prisma.teacherRoleAssignment.findFirst({
    where: { id: assignmentId, teacherId, schoolId },
    select: { id: true },
  });
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

  await prisma.teacherRoleAssignment.delete({ where: { id: assignmentId } });
  return NextResponse.json({ success: true });
}
