import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { loadTodayOperationsContext } from "@/lib/operations-context";
import { computeTeacherTodayStatuses } from "@/lib/operations-teacher-status";
import { computeAttendanceCompletion } from "@/lib/operations-attendance";
import { classifyTodayLectures, computeCurrentPeriodOperations, computeNextPeriodRisk } from "@/lib/operations-lecture-coverage";
import { computeHomeworkTodaySummary } from "@/lib/operations-homework";
import { computeExamSchemeProgress } from "@/lib/operations-exams";
import { computeNeedsAttention, loadNeedsAttentionLeaveSignals, loadNeedsAttentionJobSignals } from "@/lib/operations-attention";
import { computeOperationsHealth } from "@/lib/operations-health";
import { isOperationsHeadUnavailable } from "@/lib/operational-role-resolver";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(schoolId, "STANDARD_READ", "OPERATIONS_TODAY_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const { searchParams } = new URL(req.url);
  const examSchemeId = searchParams.get("examSchemeId") ?? undefined;

  const now = new Date();
  const ctx = await loadTodayOperationsContext(schoolId, now);
  const allLectures = classifyTodayLectures(ctx);
  const teacherStatuses = computeTeacherTodayStatuses(ctx);

  const [attendanceCompletion, currentPeriodOps, nextPeriodRisk, homeworkSummary, examProgress, leaveSignals, jobSignals, noActiveOperationsHead] = await Promise.all([
    computeAttendanceCompletion(schoolId, ctx.dateOnly),
    computeCurrentPeriodOperations(ctx, allLectures),
    computeNextPeriodRisk(ctx, allLectures),
    computeHomeworkTodaySummary(schoolId, ctx.dateOnly, now),
    examSchemeId ? computeExamSchemeProgress(schoolId, examSchemeId) : Promise.resolve(null),
    loadNeedsAttentionLeaveSignals(schoolId, ctx.dateOnly),
    loadNeedsAttentionJobSignals(schoolId, ctx.dateOnly),
    isOperationsHeadUnavailable(schoolId, now),
  ]);

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

  return NextResponse.json({ attention, health });
}
