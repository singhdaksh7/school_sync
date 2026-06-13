import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import {
  getHomeworkForTeacherAccess,
  getTeacherByUserId,
  HomeworkStudentStatusInput,
  parseOptionalNumber,
  validateScore,
} from "@/lib/homework";

const ALLOWED_SCORE_STATUSES = ["SUBMITTED", "NOT_SUBMITTED", "LATE", "CHECKED"] as const;

export async function POST(
  req: Request,
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
  if (homework.status === "CANCELLED") {
    return NextResponse.json({ error: "Cancelled homework cannot be scored" }, { status: 400 });
  }
  if (new Date() < homework.dueDate) {
    return NextResponse.json({ error: "Homework can be scored after the due date" }, { status: 400 });
  }

  const body = await req.json();
  const scores = Array.isArray(body.scores) ? (body.scores as HomeworkStudentStatusInput[]) : [];
  if (scores.length === 0) return NextResponse.json({ error: "Scores are required" }, { status: 400 });

  const uniqueStudentIds = [...new Set(scores.map((score) => score.studentId).filter(Boolean))];
  if (uniqueStudentIds.length !== scores.length) {
    return NextResponse.json({ error: "Each score must reference a unique student" }, { status: 400 });
  }

  const studentCount = await prisma.student.count({
    where: {
      id: { in: uniqueStudentIds },
      schoolId: teacher.schoolId,
      sectionId: homework.sectionId,
    },
  });
  if (studentCount !== uniqueStudentIds.length) {
    return NextResponse.json({ error: "One or more students are not in this homework section" }, { status: 400 });
  }

  const updates = [];
  for (const item of scores) {
    if (!ALLOWED_SCORE_STATUSES.includes(item.status as (typeof ALLOWED_SCORE_STATUSES)[number])) {
      return NextResponse.json({ error: "Invalid submission status" }, { status: 400 });
    }

    const score = parseOptionalNumber(item.score);
    const maxScore = parseOptionalNumber(item.maxScore);
    const scoreError = validateScore(score, maxScore);
    if (scoreError) return NextResponse.json({ error: scoreError }, { status: 400 });

    const submittedAt = item.submittedAt ? new Date(item.submittedAt) : null;
    if (item.submittedAt && Number.isNaN(submittedAt?.getTime())) {
      return NextResponse.json({ error: "Invalid submittedAt date" }, { status: 400 });
    }

    updates.push(
      prisma.homeworkStudentStatus.update({
        where: { homeworkId_studentId: { homeworkId: homework.id, studentId: item.studentId } },
        data: {
          status: item.status,
          submittedAt,
          score,
          maxScore,
          teacherRemark:
            typeof item.teacherRemark === "string" && item.teacherRemark.trim()
              ? item.teacherRemark.trim()
              : null,
          parentVisible: item.parentVisible ?? true,
          checkedAt: item.status === "CHECKED" || score !== null ? new Date() : null,
        },
      })
    );
  }

  await prisma.$transaction(updates);
  return NextResponse.json({ success: true });
}
