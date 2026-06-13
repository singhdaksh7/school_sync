import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";

type AcademicStatus = "PENDING" | "SUBMITTED" | "LATE_SUBMITTED" | "NOT_SUBMITTED" | "CHECKED" | "REJECTED";
type SubmissionMethod = "NONE" | "ONLINE" | "PHYSICAL";

type SummaryAccumulator = {
  totalAssigned: number;
  submittedCount: number;
  onlineSubmittedCount: number;
  physicalSubmittedCount: number;
  lateSubmittedCount: number;
  notSubmittedCount: number;
  checkedCount: number;
  scoredPercentages: number[];
};

function createAccumulator(): SummaryAccumulator {
  return {
    totalAssigned: 0,
    submittedCount: 0,
    onlineSubmittedCount: 0,
    physicalSubmittedCount: 0,
    lateSubmittedCount: 0,
    notSubmittedCount: 0,
    checkedCount: 0,
    scoredPercentages: [],
  };
}

function roundPercentage(value: number) {
  return Math.round(value * 100) / 100;
}

function averageScore(scoredPercentages: number[]) {
  if (scoredPercentages.length === 0) return null;
  return roundPercentage(scoredPercentages.reduce((sum, score) => sum + score, 0) / scoredPercentages.length);
}

function addRecord(
  summary: SummaryAccumulator,
  status: AcademicStatus,
  method: SubmissionMethod,
  score: number | null,
  maxScore: number | null
) {
  summary.totalAssigned += 1;

  if (status === "SUBMITTED" || status === "LATE_SUBMITTED" || status === "CHECKED") {
    summary.submittedCount += 1;
  }
  if (method === "ONLINE" && status !== "PENDING" && status !== "NOT_SUBMITTED") {
    summary.onlineSubmittedCount += 1;
  }
  if (method === "PHYSICAL" && status !== "PENDING" && status !== "NOT_SUBMITTED") {
    summary.physicalSubmittedCount += 1;
  }
  if (status === "LATE_SUBMITTED") summary.lateSubmittedCount += 1;
  if (status === "NOT_SUBMITTED") summary.notSubmittedCount += 1;
  if (status === "CHECKED") summary.checkedCount += 1;
  if (score !== null && maxScore !== null && maxScore > 0) {
    summary.scoredPercentages.push((score / maxScore) * 100);
  }
}

function toResponse(summary: SummaryAccumulator) {
  return {
    totalAssigned: summary.totalAssigned,
    submittedCount: summary.submittedCount,
    onlineSubmittedCount: summary.onlineSubmittedCount,
    physicalSubmittedCount: summary.physicalSubmittedCount,
    lateSubmittedCount: summary.lateSubmittedCount,
    notSubmittedCount: summary.notSubmittedCount,
    checkedCount: summary.checkedCount,
    averageScore: averageScore(summary.scoredPercentages),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; studentId: string }> }
) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    select: {
      id: true,
      name: true,
      rollNo: true,
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const records = await prisma.homeworkStudentStatus.findMany({
    where: {
      studentId,
      student: { schoolId },
      homework: { schoolId, status: { not: "CANCELLED" } },
    },
    include: {
      homework: {
        select: {
          id: true,
          title: true,
          subject: true,
          deadlineAt: true,
          dueDate: true,
          status: true,
          teacher: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { homework: { deadlineAt: "desc" } }],
  });

  const total = createAccumulator();
  const subjectMap = new Map<string, SummaryAccumulator>();

  for (const record of records) {
    addRecord(total, record.submissionStatus, record.submissionMethod, record.score, record.maxScore);
    const subjectSummary = subjectMap.get(record.homework.subject) ?? createAccumulator();
    addRecord(subjectSummary, record.submissionStatus, record.submissionMethod, record.score, record.maxScore);
    subjectMap.set(record.homework.subject, subjectSummary);
  }

  const subjectWiseSummary = Array.from(subjectMap.entries())
    .map(([subject, summary]) => ({ subject, ...toResponse(summary) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  const recentHomeworkRecords = records.slice(0, 10).map((record) => ({
    id: record.id,
    homeworkId: record.homeworkId,
    title: record.homework.title,
    subject: record.homework.subject,
    deadlineAt: record.homework.deadlineAt,
    dueDate: record.homework.dueDate,
    homeworkStatus: record.homework.status,
    submissionStatus: record.submissionStatus,
    submissionMethod: record.submissionMethod,
    submittedAt: record.submittedAt,
    checkedAt: record.checkedAt,
    score: record.score,
    maxScore: record.maxScore,
    teacherRemark: record.teacherRemark,
    teacher: record.homework.teacher,
  }));

  return NextResponse.json({
    student,
    ...toResponse(total),
    subjectWiseSummary,
    recentHomeworkRecords,
  });
}
