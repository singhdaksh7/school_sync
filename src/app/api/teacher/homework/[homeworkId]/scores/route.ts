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
import {
  assertTeacherScopeAccess,
  getResolvedTeacherScope,
  requireTeacherPermission,
  scopeForbidden,
} from "@/lib/teacher-permission-guard";

const ALLOWED_SCORE_STATUSES = ["SUBMITTED", "NOT_SUBMITTED", "LATE", "CHECKED", "REJECTED"] as const;
type ScoreStatus = (typeof ALLOWED_SCORE_STATUSES)[number];
type AcademicStatus = "SUBMITTED" | "LATE_SUBMITTED" | "NOT_SUBMITTED" | "CHECKED" | "REJECTED";
type SubmissionMethod = "NONE" | "ONLINE" | "PHYSICAL";

function toSubmittedStatus(submittedAt: Date, deadlineAt: Date) {
  return submittedAt > deadlineAt
    ? { legacyStatus: "LATE" as const, academicStatus: "LATE_SUBMITTED" as const }
    : { legacyStatus: "SUBMITTED" as const, academicStatus: "SUBMITTED" as const };
}

function isEvaluationStatus(status: ScoreStatus) {
  return status === "CHECKED";
}

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

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", ["REVIEW", "MANAGE_ALL"]);
  if (denied) return denied;
  const scope = await getResolvedTeacherScope(teacher.id, teacher.schoolId);
  if (!assertTeacherScopeAccess(scope, homework.sectionId)) return scopeForbidden();

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

  const existingSubmissions = await prisma.homeworkSubmission.findMany({
    where: {
      homeworkId: homework.id,
      schoolId: teacher.schoolId,
      studentId: { in: uniqueStudentIds },
    },
  });
  const submissionByStudentId = new Map(existingSubmissions.map((submission) => [submission.studentId, submission]));
  const now = new Date();
  const deadlineAt = homework.deadlineAt;

  for (const item of scores) {
    if (!ALLOWED_SCORE_STATUSES.includes(item.status as ScoreStatus)) {
      return NextResponse.json({ error: "Invalid submission status" }, { status: 400 });
    }
    const requestedStatus = item.status as ScoreStatus;

    const score = parseOptionalNumber(item.score);
    const maxScore = parseOptionalNumber(item.maxScore);
    const scoreError = validateScore(score, maxScore);
    if (scoreError) return NextResponse.json({ error: scoreError }, { status: 400 });

    const submittedAt = item.submittedAt ? new Date(item.submittedAt) : null;
    if (item.submittedAt && Number.isNaN(submittedAt?.getTime())) {
      return NextResponse.json({ error: "Invalid submittedAt date" }, { status: 400 });
    }

    const teacherRemark =
      typeof item.teacherRemark === "string" && item.teacherRemark.trim()
        ? item.teacherRemark.trim()
        : null;

    if (requestedStatus === "REJECTED" && !teacherRemark) {
      return NextResponse.json({ error: "Teacher remark is required when rejecting homework" }, { status: 400 });
    }

    if (requestedStatus === "NOT_SUBMITTED") {
      if (now <= deadlineAt) {
        return NextResponse.json({ error: "Homework can be marked not submitted only after the deadline" }, { status: 400 });
      }
      if (score !== null || maxScore !== null) {
        return NextResponse.json({ error: "Not submitted homework cannot have a score" }, { status: 400 });
      }
      continue;
    }

    if (!isEvaluationStatus(requestedStatus) && (score !== null || maxScore !== null)) {
      return NextResponse.json({ error: "Scores can be saved only when checking homework" }, { status: 400 });
    }

    if (isEvaluationStatus(requestedStatus) && (score === null || maxScore === null)) {
      return NextResponse.json({ error: "Score and max score are required when checking homework" }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const item of scores) {
      const requestedStatus = item.status as ScoreStatus;
      const score = parseOptionalNumber(item.score);
      const maxScore = parseOptionalNumber(item.maxScore);
      const existingSubmission = submissionByStudentId.get(item.studentId);
      const teacherRemark =
        typeof item.teacherRemark === "string" && item.teacherRemark.trim()
          ? item.teacherRemark.trim()
          : null;

      if (requestedStatus === "NOT_SUBMITTED") {
        await tx.homeworkStudentStatus.update({
          where: { homeworkId_studentId: { homeworkId: homework.id, studentId: item.studentId } },
          data: {
            status: "NOT_SUBMITTED",
            submissionStatus: "NOT_SUBMITTED",
            submissionMethod: "NONE",
            submittedAt: null,
            score: null,
            maxScore: null,
            teacherRemark,
            parentVisible: item.parentVisible ?? true,
            checkedAt: null,
          },
        });
        continue;
      }

      const submittedAt = item.submittedAt ? new Date(item.submittedAt) : existingSubmission?.submittedAt ?? now;
      const submittedStatus = toSubmittedStatus(submittedAt, deadlineAt);
      const academicStatus: AcademicStatus =
        requestedStatus === "REJECTED" ? "REJECTED" : isEvaluationStatus(requestedStatus) ? "CHECKED" : submittedStatus.academicStatus;
      const legacyStudentStatus =
        academicStatus === "CHECKED"
          ? "CHECKED"
          : academicStatus === "REJECTED"
            ? "NOT_SUBMITTED"
            : submittedStatus.legacyStatus;
      const submissionMethod: SubmissionMethod =
        item.submissionMethod === "ONLINE" || existingSubmission?.submissionMethod === "ONLINE"
          ? "ONLINE"
          : "PHYSICAL";
      const checkedAt = academicStatus === "CHECKED" || academicStatus === "REJECTED" ? now : null;

      await tx.homeworkStudentStatus.update({
        where: { homeworkId_studentId: { homeworkId: homework.id, studentId: item.studentId } },
        data: {
          status: legacyStudentStatus,
          submissionStatus: academicStatus,
          submissionMethod,
          submittedAt,
          score,
          maxScore,
          teacherRemark,
          parentVisible: item.parentVisible ?? true,
          checkedAt,
        },
      });

      await tx.homeworkSubmission.upsert({
        where: { homeworkId_studentId: { homeworkId: homework.id, studentId: item.studentId } },
        create: {
          schoolId: homework.schoolId,
          homeworkId: homework.id,
          studentId: item.studentId,
          attachmentUrl: null,
          submittedAt,
          status:
            academicStatus === "CHECKED"
              ? "REVIEWED"
              : academicStatus === "REJECTED"
                ? "REJECTED"
                : submittedStatus.legacyStatus,
          submissionStatus: academicStatus,
          submissionMethod,
          score,
          maxScore,
          teacherRemark,
          reviewedAt: checkedAt,
          checkedAt,
        },
        update: {
          submittedAt,
          status:
            academicStatus === "CHECKED"
              ? "REVIEWED"
              : academicStatus === "REJECTED"
                ? "REJECTED"
                : submittedStatus.legacyStatus,
          submissionStatus: academicStatus,
          submissionMethod,
          score,
          maxScore,
          teacherRemark,
          reviewedAt: checkedAt,
          checkedAt,
        },
      });
    }
  });
  return NextResponse.json({ success: true });
}
