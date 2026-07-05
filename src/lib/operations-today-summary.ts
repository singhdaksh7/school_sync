/**
 * School Operations Command Center — "Today at School" summary (PART 7).
 * The lightweight dashboard-glance composition: who's present/absent/on-leave,
 * currently-running classes, coverage, and next-period risk. Deliberately
 * NOT the full digest (that's operations-daily-summary.ts's Daily Operations
 * Summary, PART 20) — kept separate per PART 22's "avoid one giant endpoint".
 */

import { loadTodayOperationsContext } from "@/lib/operations-context";
import { computeTeacherTodayStatuses, summarizeTeacherStatuses } from "@/lib/operations-teacher-status";
import { computeStudentAttendanceSummary } from "@/lib/operations-attendance";
import { classifyTodayLectures, summarizeCoverage, computeCurrentPeriodOperations, computeNextPeriodRisk } from "@/lib/operations-lecture-coverage";

export interface TodayAtSchoolSummary {
  dateKey: string;
  timeOfDay: string;
  periodState: string;
  teacherSummary: ReturnType<typeof summarizeTeacherStatuses>;
  studentAttendance: Awaited<ReturnType<typeof computeStudentAttendanceSummary>>;
  coverage: ReturnType<typeof summarizeCoverage>;
  currentPeriod: Awaited<ReturnType<typeof computeCurrentPeriodOperations>>;
  nextPeriodRisk: Awaited<ReturnType<typeof computeNextPeriodRisk>>;
}

export async function computeTodayAtSchoolSummary(schoolId: string, now: Date = new Date()): Promise<TodayAtSchoolSummary> {
  const ctx = await loadTodayOperationsContext(schoolId, now);
  const allLectures = classifyTodayLectures(ctx);

  const [studentAttendance, currentPeriod, nextPeriodRisk] = await Promise.all([
    computeStudentAttendanceSummary(schoolId, ctx.dateOnly),
    computeCurrentPeriodOperations(ctx, allLectures),
    computeNextPeriodRisk(ctx, allLectures),
  ]);

  const teacherStatuses = computeTeacherTodayStatuses(ctx);

  return {
    dateKey: ctx.dateKey,
    timeOfDay: ctx.timeOfDay,
    periodState: ctx.periodState.status,
    teacherSummary: summarizeTeacherStatuses(teacherStatuses),
    studentAttendance,
    coverage: summarizeCoverage(allLectures),
    currentPeriod,
    nextPeriodRisk,
  };
}
