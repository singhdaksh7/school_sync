import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { getHomeworkForTeacherAccess, getTeacherByUserId } from "@/lib/homework";
import {
  assertTeacherScopeAccess,
  getResolvedTeacherScope,
  requireTeacherPermission,
  scopeForbidden,
} from "@/lib/teacher-permission-guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ homeworkId: string }> }
) {
  const { homeworkId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherByUserId(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const homework = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "VIEW");
  if (denied) return denied;
  const scope = await getResolvedTeacherScope(teacher.id, teacher.schoolId);
  if (!assertTeacherScopeAccess(scope, homework.sectionId)) return scopeForbidden();

  const submissions = await prisma.homeworkSubmission.findMany({
    where: {
      schoolId: teacher.schoolId,
      homeworkId: homework.id,
      student: {
        schoolId: teacher.schoolId,
        sectionId: homework.sectionId,
      },
    },
    include: {
      student: { select: { id: true, name: true, rollNo: true, sectionId: true } },
      guardian: { select: { id: true, name: true, phone: true } },
    },
    orderBy: [{ student: { rollNo: "asc" } }, { submittedAt: "desc" }],
  });

  return NextResponse.json({ homework, submissions });
}
