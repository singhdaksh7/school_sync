import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import {
  addHomeworkStatsRecord,
  createHomeworkStatsAccumulator,
  homeworkStatsToResponse,
  isHomeworkVisibleToStudents,
  type HomeworkStatsAccumulator,
} from "@/lib/homework";

export async function GET(req: NextRequest) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(auth.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const records = await prisma.homeworkStudentStatus.findMany({
    where: {
      studentId: auth.studentId,
      student: { schoolId: auth.schoolId },
      homework: { schoolId: auth.schoolId, status: { not: "CANCELLED" } },
    },
    include: {
      homework: { select: { subject: true, status: true, dueDate: true } },
    },
  });

  // Same visibility rule as the detailed student list (GET /api/student/homework):
  // DRAFT and not-yet-started SCHEDULED homework must never count toward
  // totals/completion percentages. Filtering here (rather than duplicating a
  // second ad-hoc rule) is what keeps the summary and the list consistent.
  const visibleRecords = records.filter((record) => isHomeworkVisibleToStudents(record.homework));

  const total = createHomeworkStatsAccumulator();
  const subjectMap = new Map<string, HomeworkStatsAccumulator>();

  for (const record of visibleRecords) {
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
