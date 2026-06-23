import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import {
  addHomeworkStatsRecord,
  createHomeworkStatsAccumulator,
  homeworkStatsToResponse,
  type HomeworkStatsAccumulator,
} from "@/lib/homework";

export async function GET(req: NextRequest) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const records = await prisma.homeworkStudentStatus.findMany({
    where: {
      studentId: auth.studentId,
      student: { schoolId: auth.schoolId },
      homework: { schoolId: auth.schoolId, status: { not: "CANCELLED" } },
    },
    include: {
      homework: { select: { subject: true } },
    },
  });

  const total = createHomeworkStatsAccumulator();
  const subjectMap = new Map<string, HomeworkStatsAccumulator>();

  for (const record of records) {
    addHomeworkStatsRecord(total, record.submissionStatus, record.submissionMethod, record.score, record.maxScore);
    const subjectSummary = subjectMap.get(record.homework.subject) ?? createHomeworkStatsAccumulator();
    addHomeworkStatsRecord(subjectSummary, record.submissionStatus, record.submissionMethod, record.score, record.maxScore);
    subjectMap.set(record.homework.subject, subjectSummary);
  }

  const subjectWiseSummary = Array.from(subjectMap.entries())
    .map(([subject, summary]) => ({ subject, ...homeworkStatsToResponse(summary) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  return NextResponse.json({
    ...homeworkStatsToResponse(total),
    subjectWiseSummary,
  });
}
