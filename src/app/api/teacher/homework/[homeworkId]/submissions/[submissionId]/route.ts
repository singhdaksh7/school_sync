import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import {
  getHomeworkForTeacherAccess,
  getTeacherByUserId,
  parseOptionalNumber,
  validateScore,
  validateStudentMarks,
} from "@/lib/homework";
import { resolveManagedOrLegacyUrl } from "@/lib/file-service";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ homeworkId: string; submissionId: string }> }
) {
  const { homeworkId, submissionId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const homework = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "REVIEW", {
    sectionId: homework.sectionId,
  });
  if (denied) return denied;

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

  const marksError = validateStudentMarks({
    assessmentMode: homework.assessmentMode,
    homeworkMaxMarks: homework.maxMarks,
    score,
  });
  if (marksError) return NextResponse.json({ error: marksError }, { status: 400 });

  const teacherRemark = typeof body.teacherRemark === "string" && body.teacherRemark.trim()
    ? body.teacherRemark.trim()
    : null;
  const studentFeedback = typeof body.studentFeedback === "string" && body.studentFeedback.trim()
    ? body.studentFeedback.trim()
    : null;
  if (body.status === "REJECTED" && !teacherRemark) {
    return NextResponse.json({ error: "Teacher remark is required when rejecting homework" }, { status: 400 });
  }
  // GRADED homework still requires a score when marking REVIEWED (matches
  // pre-2.0 behavior exactly); CHECKING_ONLY never requires or accepts one
  // (validateStudentMarks above already rejected any non-null score).
  if (body.status === "REVIEWED" && homework.assessmentMode === "GRADED" && (score === null || maxScore === null)) {
    return NextResponse.json({ error: "Score and max score are required when checking homework" }, { status: 400 });
  }

  const reviewedAt = new Date();
  const submissionStatus = body.status === "REVIEWED" ? "CHECKED" : "REJECTED";

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.homeworkSubmission.update({
      where: { id: submission.id },
      data: {
        status: body.status,
        score,
        maxScore,
        teacherRemark,
        studentFeedback,
        reviewedAt,
        checkedAt: reviewedAt,
        submissionStatus,
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
        submissionStatus,
        submissionMethod: submission.submissionMethod,
        submittedAt: submission.submittedAt,
        score,
        maxScore,
        teacherRemark,
        studentFeedback,
        checkedAt: reviewedAt,
      },
      update: {
        status: body.status === "REVIEWED" ? "CHECKED" : "NOT_SUBMITTED",
        submissionStatus,
        submissionMethod: submission.submissionMethod,
        submittedAt: submission.submittedAt,
        score,
        maxScore,
        teacherRemark,
        studentFeedback,
        checkedAt: reviewedAt,
      },
    });

    return saved;
  });

  const attachmentUrl = await resolveManagedOrLegacyUrl(updated);
  return NextResponse.json({ ...updated, attachmentUrl });
}
