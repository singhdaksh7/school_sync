import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { getHomeworkForTeacherAccess, getTeacherByUserId } from "@/lib/homework";

interface CompletionInput {
  studentId: string;
  completed: boolean;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ homeworkId: string }> }
) {
  const { homeworkId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const homework = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });
  if (homework.status === "CANCELLED") {
    return NextResponse.json({ error: "Cancelled homework cannot be updated" }, { status: 400 });
  }

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "REVIEW", {
    sectionId: homework.sectionId,
  });
  if (denied) return denied;

  const body = await req.json();
  const completions = Array.isArray(body.completions) ? (body.completions as CompletionInput[]) : [];
  if (completions.length === 0) {
    return NextResponse.json({ error: "Completions are required" }, { status: 400 });
  }

  const uniqueStudentIds = [...new Set(completions.map((item) => item.studentId).filter(Boolean))];
  if (uniqueStudentIds.length !== completions.length) {
    return NextResponse.json({ error: "Each completion must reference a unique student" }, { status: 400 });
  }
  if (completions.some((item) => typeof item.completed !== "boolean")) {
    return NextResponse.json({ error: "completed must be a boolean" }, { status: 400 });
  }

  const studentCount = await prisma.student.count({
    where: { id: { in: uniqueStudentIds }, schoolId: teacher.schoolId, sectionId: homework.sectionId },
  });
  if (studentCount !== uniqueStudentIds.length) {
    return NextResponse.json({ error: "One or more students are not in this homework section" }, { status: 400 });
  }

  const now = new Date();
  let completedCount = 0;
  let notCompletedCount = 0;

  await prisma.$transaction(
    completions.map((item) => {
      if (item.completed) completedCount += 1;
      else notCompletedCount += 1;

      return prisma.homeworkStudentStatus.update({
        where: { homeworkId_studentId: { homeworkId: homework.id, studentId: item.studentId } },
        data: item.completed
          ? {
              status: "CHECKED",
              submissionStatus: "CHECKED",
              checkedAt: now,
              markedAt: now,
              markedByTeacherId: teacher.id,
            }
          : {
              status: "NOT_SUBMITTED",
              submissionStatus: "NOT_SUBMITTED",
              checkedAt: null,
              submittedAt: null,
              score: null,
              maxScore: null,
              markedAt: now,
              markedByTeacherId: teacher.id,
            },
      });
    })
  );

  await logAudit({
    action: "HOMEWORK_COMPLETION_UPDATED",
    entityType: "Homework",
    entityId: homework.id,
    metadata: { completedCount, notCompletedCount },
    userId: teacherAuth.userId,
    schoolId: teacher.schoolId,
    actorRole: "TEACHER",
  });

  return NextResponse.json({ success: true });
}
