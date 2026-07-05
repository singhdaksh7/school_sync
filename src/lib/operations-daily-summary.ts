/**
 * School Operations Command Center — Daily Operations Summary (PART 20).
 * Pure composition: every field here is produced by an existing engine from
 * this phase — nothing is re-derived. `examSchemeId` is optional and, when
 * omitted, the exam/report-card sections are simply absent (never guessed —
 * see operations-exams.ts/operations-report-cards.ts for why "current exam"
 * cannot be inferred).
 */

import { loadTodayOperationsContext } from "@/lib/operations-context";
import { computeTeacherTodayStatuses, summarizeTeacherStatuses } from "@/lib/operations-teacher-status";
import { computeStudentAttendanceSummary, computeAttendanceCompletion, lowestAttendanceSections } from "@/lib/operations-attendance";
import {
  classifyTodayLectures,
  summarizeCoverage,
  computeCurrentPeriodOperations,
  computeNextPeriodRisk,
} from "@/lib/operations-lecture-coverage";
import { computeTeacherWorkloadToday, summarizeTeacherWorkload } from "@/lib/operations-teacher-workload";
import { computeHomeworkTodaySummary, topPendingReviewGroups } from "@/lib/operations-homework";
import { computeExamSchemeProgress, type ExamSchemeProgress } from "@/lib/operations-exams";
import { computeReportCardProgress, type ReportCardSchemeProgress } from "@/lib/operations-report-cards";
import { computeFeeTodaySummary, recentFeePayments } from "@/lib/operations-fees";
import { computeNeedsAttention, loadNeedsAttentionLeaveSignals, loadNeedsAttentionJobSignals, type AttentionItem } from "@/lib/operations-attention";
import { loadTodayActivityTimeline, DEFAULT_ACTIVITY_LIMIT, type ActivityTimelinePage } from "@/lib/operations-activity";
import { computeOperationsHealth, type OperationsHealth } from "@/lib/operations-health";
import { isOperationsHeadUnavailable } from "@/lib/operational-role-resolver";

export interface DailyOperationsSummary {
  dateKey: string;
  timeOfDay: string;
  periodState: string;
  teachers: {
    summary: ReturnType<typeof summarizeTeacherStatuses>;
  };
  attendance: {
    students: Awaited<ReturnType<typeof computeStudentAttendanceSummary>>;
    completion: Awaited<ReturnType<typeof computeAttendanceCompletion>>;
    lowestSections: ReturnType<typeof lowestAttendanceSections>;
  };
  coverage: ReturnType<typeof summarizeCoverage>;
  currentPeriod: Awaited<ReturnType<typeof computeCurrentPeriodOperations>>;
  nextPeriodRisk: Awaited<ReturnType<typeof computeNextPeriodRisk>>;
  workload: {
    summary: ReturnType<typeof summarizeTeacherWorkload>;
  };
  homework: {
    summary: Awaited<ReturnType<typeof computeHomeworkTodaySummary>>;
    topPendingReview: Awaited<ReturnType<typeof topPendingReviewGroups>>;
  };
  exams: ExamSchemeProgress | null;
  reportCards: ReportCardSchemeProgress | null;
  fees: {
    summary: Awaited<ReturnType<typeof computeFeeTodaySummary>>;
    recentPayments: Awaited<ReturnType<typeof recentFeePayments>>;
  };
  attention: AttentionItem[];
  health: OperationsHealth;
  activity: ActivityTimelinePage;
}

export async function computeDailyOperationsSummary(
  schoolId: string,
  now: Date = new Date(),
  opts: { examSchemeId?: string } = {}
): Promise<DailyOperationsSummary> {
  const ctx = await loadTodayOperationsContext(schoolId, now);
  const allLectures = classifyTodayLectures(ctx);

  const teacherStatuses = computeTeacherTodayStatuses(ctx);
  const teacherStatusSummary = summarizeTeacherStatuses(teacherStatuses);

  const [
    studentAttendance,
    attendanceCompletion,
    currentPeriodOps,
    nextPeriodRisk,
    homeworkSummary,
    topPendingReview,
    examProgress,
    reportCardProgress,
    feeSummary,
    recentPayments,
    leaveSignals,
    jobSignals,
    activity,
    noActiveOperationsHead,
  ] = await Promise.all([
    computeStudentAttendanceSummary(schoolId, ctx.dateOnly),
    computeAttendanceCompletion(schoolId, ctx.dateOnly),
    computeCurrentPeriodOperations(ctx, allLectures),
    computeNextPeriodRisk(ctx, allLectures),
    computeHomeworkTodaySummary(schoolId, ctx.dateOnly, now),
    topPendingReviewGroups(schoolId),
    opts.examSchemeId ? computeExamSchemeProgress(schoolId, opts.examSchemeId) : Promise.resolve(null),
    opts.examSchemeId ? computeReportCardProgress(schoolId, opts.examSchemeId) : Promise.resolve(null),
    computeFeeTodaySummary(schoolId, ctx.dateOnly),
    recentFeePayments(schoolId),
    loadNeedsAttentionLeaveSignals(schoolId, ctx.dateOnly),
    loadNeedsAttentionJobSignals(schoolId, ctx.dateOnly),
    loadTodayActivityTimeline(schoolId, ctx.dateOnly, { take: DEFAULT_ACTIVITY_LIMIT }),
    isOperationsHeadUnavailable(schoolId, now),
  ]);

  const workloadRows = computeTeacherWorkloadToday(ctx);
  const workloadSummary = summarizeTeacherWorkload(workloadRows);

  const attention = computeNeedsAttention({
    currentPeriodOps,
    nextPeriodRisk,
    attendanceCompletion,
    teacherStatuses,
    pendingTeacherLeaveCount: leaveSignals.pendingTeacherLeaveCount,
    pendingEarlyLeaveCount: leaveSignals.pendingEarlyLeaveCount,
    homeworkPendingReviewCount: homeworkSummary.pendingReview,
    examMarksPendingCount: examProgress?.totalPendingResults,
    reportCardJobsCompletedToday: jobSignals.reportCardJobsCompletedToday,
    reportCardJobsFailedToday: jobSignals.reportCardJobsFailedToday,
    smartTimetableDraftsReady: jobSignals.smartTimetableDraftsReady,
    smartTimetableJobsFailed: jobSignals.smartTimetableJobsFailed,
    noActiveOperationsHead,
  });

  const health = computeOperationsHealth(attention);

  return {
    dateKey: ctx.dateKey,
    timeOfDay: ctx.timeOfDay,
    periodState: ctx.periodState.status,
    teachers: { summary: teacherStatusSummary },
    attendance: {
      students: studentAttendance,
      completion: attendanceCompletion,
      lowestSections: lowestAttendanceSections(attendanceCompletion.sections),
    },
    coverage: summarizeCoverage(allLectures),
    currentPeriod: currentPeriodOps,
    nextPeriodRisk,
    workload: { summary: workloadSummary },
    homework: { summary: homeworkSummary, topPendingReview },
    exams: examProgress,
    reportCards: reportCardProgress,
    fees: { summary: feeSummary, recentPayments },
    attention,
    health,
    activity,
  };
}
