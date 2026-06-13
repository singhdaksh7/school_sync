import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import {
  getHomeworkForTeacherAccess,
  getTeacherByUserId,
  parseOptionalNumber,
  validateScore,
} from "@/lib/homework";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ homeworkId: string; submissionId: string }> }
) {
  const { homeworkId, submissionId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherByUserId(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const homework = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });

  const submission = await prisma.homeworkSubmission.findFirst({
    where: {
      id: submissionId,
      homeworkId: homework.id,
      schoolId: teacher.schoolId,
      student: {
        schoolId: teacher.schoolId,
        sectionId: homework.sectionId,
      },
    },
  });
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

  const body = await req.json();
  if (!["REVIEWED", "REJECTED"].includes(body.status)) {
    return NextResponse.json({ error: "Status must be REVIEWED or REJECTED" }, { status: 400 });
  }

  const score = parseOptionalNumber(body.score);
  const maxScore = parseOptionalNumber(body.maxScore);
  const scoreError = validateScore(score, maxScore);
  if (scoreError) return NextResponse.json({ error: scoreError }, { status: 400 });

  const teacherRemark = typeof body.teacherRemark === "string" && body.teacherRemark.trim()
    ? body.teacherRemark.trim()
    : null;
  const reviewedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.homeworkSubmission.update({
      where: { id: submission.id },
      data: {
        status: body.status,
        score,
        maxScore,
        teacherRemark,
        reviewedAt,
      },
      include: {
        student: { select: { id: true, name: true, rollNo: true, sectionId: true } },
        guardian: { select: { id: true, name: true, phone: true } },
      },
    });

    await tx.homeworkStudentStatus.upsert({
      where: { homeworkId_studentId: { homeworkId: homework.id, studentId: submission.studentId } },
      create: {
        homeworkId: homework.id,
        studentId: submission.studentId,
        status: body.status === "REVIEWED" ? "CHECKED" : "NOT_SUBMITTED",
        submittedAt: submission.submittedAt,
        score,
        maxScore,
        teacherRemark,
        checkedAt: reviewedAt,
      },
      update: {
        status: body.status === "REVIEWED" ? "CHECKED" : "NOT_SUBMITTED",
        submittedAt: submission.submittedAt,
        score,
        maxScore,
        teacherRemark,
        checkedAt: reviewedAt,
      },
    });

    return saved;
  });

  return NextResponse.json(updated);
}
