/**
 * School Operations Command Center — exam/marks progress insights (PART 16).
 *
 * "Current exam" is NOT inferable from existing data: `ExamScheme`/`Exam`/
 * `ExamResult` have zero date or status fields (confirmed by schema audit),
 * so this module requires an explicit `examSchemeId` caller-supplied
 * parameter rather than guessing from `latest createdAt`.
 *
 * Honesty caveat (also schema-driven): `Exam` has no class/section scoping
 * field, so "expected results" for an exam is computed against the whole
 * school's active student roster, not a class-specific roster. Documented
 * here and in docs/school-operations-command-center.md rather than silently
 * assumed.
 */

import { prisma } from "@/lib/prisma";

export interface ExamProgressRow {
  examId: string;
  examName: string;
  maxMarks: number;
  totalStudents: number;
  resultsSubmitted: number;
  pendingCount: number;
  completionPercentage: number | null;
}

export interface ExamSchemeProgress {
  examSchemeId: string;
  exams: ExamProgressRow[];
  totalPendingResults: number;
}

export async function computeExamSchemeProgress(schoolId: string, examSchemeId: string): Promise<ExamSchemeProgress | null> {
  const scheme = await prisma.examScheme.findFirst({
    where: { id: examSchemeId, schoolId },
    select: { id: true, exams: { select: { id: true, name: true, maxMarks: true } } },
  });
  if (!scheme) return null;

  const examIds = scheme.exams.map((e) => e.id);
  const [totalStudents, resultCounts] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    examIds.length > 0
      ? prisma.examResult.groupBy({ by: ["examId"], where: { examId: { in: examIds } }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const countByExam = new Map(resultCounts.map((r) => [r.examId, r._count._all]));

  const exams: ExamProgressRow[] = scheme.exams.map((e) => {
    const resultsSubmitted = countByExam.get(e.id) ?? 0;
    return {
      examId: e.id,
      examName: e.name,
      maxMarks: e.maxMarks,
      totalStudents,
      resultsSubmitted,
      pendingCount: Math.max(0, totalStudents - resultsSubmitted),
      completionPercentage: totalStudents > 0 ? Math.round((resultsSubmitted / totalStudents) * 1000) / 10 : null,
    };
  });

  return {
    examSchemeId,
    exams,
    totalPendingResults: exams.reduce((sum, e) => sum + e.pendingCount, 0),
  };
}
