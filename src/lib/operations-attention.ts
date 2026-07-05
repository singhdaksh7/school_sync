/**
 * School Operations Command Center — Needs Attention engine (PART 14).
 *
 * Consumes the already-computed outputs of the other engines (lecture
 * coverage/current-period/next-period-risk, attendance completion, teacher
 * status) rather than re-querying or re-deriving them. The homework/exam/
 * report-card/Smart-Timetable-job signals are accepted as OPTIONAL inputs so
 * this engine can be built and unit-tested now, ahead of PART 15-18/Smart
 * Timetable job wiring (task #70) — when absent, those attention codes simply
 * produce no items rather than throwing or guessing.
 *
 * Priority order (PART 14): severity, then operational imminence (how soon
 * the underlying situation affects a real class/period — lower = more
 * urgent), then count (descending), then the stable `code` string (so
 * ordering is fully deterministic, never dependent on object insertion order).
 */

import { prisma } from "@/lib/prisma";
import type { CurrentPeriodOperations, NextPeriodRisk } from "@/lib/operations-lecture-coverage";
import type { AttendanceCompletionSummary } from "@/lib/operations-attendance";
import type { TeacherTodayStatus } from "@/lib/operations-teacher-status";

export type AttentionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type AttentionCode =
  | "UNCOVERED_LECTURES"
  | "NEXT_PERIOD_UNCOVERED"
  | "ATTENDANCE_PENDING"
  | "ATTENDANCE_PARTIAL"
  | "TEACHER_STATUS_NOT_MARKED"
  | "TEACHER_LEAVE_PENDING"
  | "EARLY_LEAVE_PENDING"
  | "HOMEWORK_REVIEW_BACKLOG"
  | "EXAM_MARKS_PENDING"
  | "REPORT_CARD_JOB_COMPLETED"
  | "REPORT_CARD_GENERATION_FAILED"
  | "SMART_TIMETABLE_DRAFT_READY"
  | "SMART_TIMETABLE_JOB_FAILED"
  | "NO_ACTIVE_OPERATIONS_HEAD";

/** Lower = more operationally urgent (affects a class happening now or very soon). Named/documented, not scattered. */
const IMMINENCE: Record<AttentionCode, number> = {
  UNCOVERED_LECTURES: 0,
  NEXT_PERIOD_UNCOVERED: 1,
  REPORT_CARD_GENERATION_FAILED: 1,
  SMART_TIMETABLE_JOB_FAILED: 1,
  TEACHER_STATUS_NOT_MARKED: 2,
  EARLY_LEAVE_PENDING: 2,
  ATTENDANCE_PENDING: 2,
  EXAM_MARKS_PENDING: 3,
  ATTENDANCE_PARTIAL: 3,
  TEACHER_LEAVE_PENDING: 4,
  HOMEWORK_REVIEW_BACKLOG: 4,
  REPORT_CARD_JOB_COMPLETED: 5,
  SMART_TIMETABLE_DRAFT_READY: 5,
  NO_ACTIVE_OPERATIONS_HEAD: 2,
};

export interface AttentionItem {
  code: AttentionCode;
  severity: AttentionSeverity;
  title: string;
  description: string;
  count: number;
  /** Stable route-shaped hint for where the client should navigate — never free text. */
  actionTarget: string | null;
  metadata: Record<string, unknown>;
}

export const DEFAULT_ATTENTION_LIMIT = 10;

/**
 * Optional signals not yet produced elsewhere in this phase (homework/exam/
 * report-card insights are task #70; Smart Timetable job/draft status is
 * read directly here since it is self-contained). Absent/undefined fields
 * simply suppress their corresponding attention codes.
 */
export interface NeedsAttentionInputs {
  currentPeriodOps: CurrentPeriodOperations;
  nextPeriodRisk: NextPeriodRisk;
  attendanceCompletion: AttendanceCompletionSummary;
  teacherStatuses: TeacherTodayStatus[];
  pendingTeacherLeaveCount: number;
  pendingEarlyLeaveCount: number;
  homeworkPendingReviewCount?: number;
  examMarksPendingCount?: number;
  reportCardJobsCompletedToday?: number;
  reportCardJobsFailedToday?: number;
  smartTimetableDraftsReady?: number;
  smartTimetableJobsFailed?: number;
  /**
   * Teacher Operations Head & Automatic Delegation (Phase 3): true only when
   * a TEACHER_OPERATIONS chain IS configured (at least one assignment exists)
   * AND `resolveEffectiveOperationalRole` currently returns no effective
   * assignee. A school that has never configured the role never sees this
   * item — deliberately decoupled from the Phase 3 resolver's own types so
   * this engine stays a plain boolean-signal consumer, matching every other
   * cross-phase input here.
   */
  noActiveOperationsHead?: boolean;
}

function severityForCount(count: number, thresholds: { high: number; critical?: number }): AttentionSeverity {
  if (thresholds.critical !== undefined && count >= thresholds.critical) return "CRITICAL";
  if (count >= thresholds.high) return "HIGH";
  return "MEDIUM";
}

export function computeNeedsAttention(inputs: NeedsAttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (inputs.currentPeriodOps.uncovered > 0) {
    items.push({
      code: "UNCOVERED_LECTURES",
      severity: "CRITICAL",
      title: "Uncovered lectures right now",
      description: `${inputs.currentPeriodOps.uncovered} class(es) currently in session have no assigned teacher.`,
      count: inputs.currentPeriodOps.uncovered,
      actionTarget: "operations/current-period",
      metadata: { periodNumber: inputs.currentPeriodOps.periodNumber },
    });
  }

  if (inputs.nextPeriodRisk.hasNextPeriod && inputs.nextPeriodRisk.uncovered > 0) {
    items.push({
      code: "NEXT_PERIOD_UNCOVERED",
      severity: inputs.nextPeriodRisk.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH",
      title: "Next period at risk of uncovered lectures",
      description: `${inputs.nextPeriodRisk.uncovered} class(es) in the next period have no assigned or substitute teacher.`,
      count: inputs.nextPeriodRisk.uncovered,
      actionTarget: "operations/next-period-risk",
      metadata: { periodNumber: inputs.nextPeriodRisk.periodNumber, riskLevel: inputs.nextPeriodRisk.riskLevel, startsInMinutes: inputs.nextPeriodRisk.startsInMinutes },
    });
  }

  if (inputs.attendanceCompletion.pendingSections > 0) {
    items.push({
      code: "ATTENDANCE_PENDING",
      severity: severityForCount(inputs.attendanceCompletion.pendingSections, { high: 3 }),
      title: "Sections with no attendance recorded today",
      description: `${inputs.attendanceCompletion.pendingSections} section(s) have not submitted attendance today.`,
      count: inputs.attendanceCompletion.pendingSections,
      actionTarget: "operations/attendance",
      metadata: {},
    });
  }

  if (inputs.attendanceCompletion.partialSections > 0) {
    items.push({
      code: "ATTENDANCE_PARTIAL",
      severity: "LOW",
      title: "Sections with partial attendance today",
      description: `${inputs.attendanceCompletion.partialSections} section(s) have incomplete attendance today.`,
      count: inputs.attendanceCompletion.partialSections,
      actionTarget: "operations/attendance",
      metadata: {},
    });
  }

  const notMarkedCount = inputs.teacherStatuses.filter((t) => t.baseStatus === "NOT_MARKED").length;
  if (notMarkedCount > 0) {
    items.push({
      code: "TEACHER_STATUS_NOT_MARKED",
      severity: severityForCount(notMarkedCount, { high: 5 }),
      title: "Teachers with no attendance status marked today",
      description: `${notMarkedCount} teacher(s) have neither checked in nor been marked today.`,
      count: notMarkedCount,
      actionTarget: "operations/teachers/status",
      metadata: {},
    });
  }

  if (inputs.pendingTeacherLeaveCount > 0) {
    items.push({
      code: "TEACHER_LEAVE_PENDING",
      severity: "LOW",
      title: "Teacher leave requests awaiting review",
      description: `${inputs.pendingTeacherLeaveCount} teacher leave request(s) are pending approval.`,
      count: inputs.pendingTeacherLeaveCount,
      actionTarget: "leave-requests",
      metadata: {},
    });
  }

  if (inputs.pendingEarlyLeaveCount > 0) {
    items.push({
      code: "EARLY_LEAVE_PENDING",
      severity: "MEDIUM",
      title: "Early-leave requests awaiting review",
      description: `${inputs.pendingEarlyLeaveCount} early-leave request(s) for today are pending approval.`,
      count: inputs.pendingEarlyLeaveCount,
      actionTarget: "leave-requests",
      metadata: {},
    });
  }

  if (inputs.homeworkPendingReviewCount && inputs.homeworkPendingReviewCount > 0) {
    items.push({
      code: "HOMEWORK_REVIEW_BACKLOG",
      severity: "LOW",
      title: "Homework submissions pending review",
      description: `${inputs.homeworkPendingReviewCount} homework submission(s) are awaiting review.`,
      count: inputs.homeworkPendingReviewCount,
      actionTarget: "homework",
      metadata: {},
    });
  }

  if (inputs.examMarksPendingCount && inputs.examMarksPendingCount > 0) {
    items.push({
      code: "EXAM_MARKS_PENDING",
      severity: "MEDIUM",
      title: "Exam marks pending entry",
      description: `${inputs.examMarksPendingCount} result(s) are still missing marks.`,
      count: inputs.examMarksPendingCount,
      actionTarget: "exams",
      metadata: {},
    });
  }

  if (inputs.reportCardJobsCompletedToday && inputs.reportCardJobsCompletedToday > 0) {
    items.push({
      code: "REPORT_CARD_JOB_COMPLETED",
      severity: "LOW",
      title: "Report card jobs completed today",
      description: `${inputs.reportCardJobsCompletedToday} report card generation job(s) finished today.`,
      count: inputs.reportCardJobsCompletedToday,
      actionTarget: "report-cards",
      metadata: {},
    });
  }

  if (inputs.reportCardJobsFailedToday && inputs.reportCardJobsFailedToday > 0) {
    items.push({
      code: "REPORT_CARD_GENERATION_FAILED",
      severity: "HIGH",
      title: "Report card generation failures today",
      description: `${inputs.reportCardJobsFailedToday} report card generation job(s) failed today.`,
      count: inputs.reportCardJobsFailedToday,
      actionTarget: "report-cards",
      metadata: {},
    });
  }

  if (inputs.smartTimetableDraftsReady && inputs.smartTimetableDraftsReady > 0) {
    items.push({
      code: "SMART_TIMETABLE_DRAFT_READY",
      severity: "LOW",
      title: "Smart Timetable drafts ready for review",
      description: `${inputs.smartTimetableDraftsReady} timetable draft(s) are ready for review.`,
      count: inputs.smartTimetableDraftsReady,
      actionTarget: "smart-timetable/drafts",
      metadata: {},
    });
  }

  if (inputs.smartTimetableJobsFailed && inputs.smartTimetableJobsFailed > 0) {
    items.push({
      code: "SMART_TIMETABLE_JOB_FAILED",
      severity: "HIGH",
      title: "Smart Timetable generation failures today",
      description: `${inputs.smartTimetableJobsFailed} timetable generation job(s) failed today.`,
      count: inputs.smartTimetableJobsFailed,
      actionTarget: "smart-timetable/drafts",
      metadata: {},
    });
  }

  if (inputs.noActiveOperationsHead) {
    // WARNING normally, escalated to CRITICAL only when there is also a real
    // imminent coverage risk (PART 25) — never a second, independent scoring
    // system; reuses the SAME uncovered-lecture facts already in scope.
    const hasImminentCoverageRisk = inputs.currentPeriodOps.uncovered > 0 || inputs.nextPeriodRisk.uncovered > 0;
    items.push({
      code: "NO_ACTIVE_OPERATIONS_HEAD",
      severity: hasImminentCoverageRisk ? "CRITICAL" : "MEDIUM",
      title: "No teacher is currently authorised to manage School Operations",
      description: "The Teacher Operations Head leadership chain is configured, but no Primary or Alternate is currently available.",
      count: 1,
      actionTarget: "OPERATIONS_ROLE_CONFIGURATION",
      metadata: {},
    });
  }

  const severityRank: Record<AttentionSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  items.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      IMMINENCE[a.code] - IMMINENCE[b.code] ||
      b.count - a.count ||
      a.code.localeCompare(b.code)
  );

  return items;
}

/** Loads the two signals this engine needs that no prior engine already computed. */
export async function loadNeedsAttentionLeaveSignals(schoolId: string, dateOnly: Date): Promise<{ pendingTeacherLeaveCount: number; pendingEarlyLeaveCount: number }> {
  const [pendingTeacherLeaveCount, pendingEarlyLeaveCount] = await Promise.all([
    prisma.leaveRequest.count({ where: { schoolId, type: "TEACHER", status: "PENDING" } }),
    prisma.teacherEarlyLeaveRequest.count({ where: { schoolId, status: "PENDING", date: dateOnly } }),
  ]);
  return { pendingTeacherLeaveCount, pendingEarlyLeaveCount };
}

function nextDay(d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n;
}

/**
 * Loads the report-card-job and Smart-Timetable-draft/job signals from
 * `BackgroundJob`/`TimetableDraft` (Wave B durable-job infra, Smart Timetable
 * phase) — reused directly, no new tracking model. Scoped to "today" so a
 * ready draft or a completed job doesn't linger in every future day's digest
 * once actioned.
 */
export async function loadNeedsAttentionJobSignals(
  schoolId: string,
  dateOnly: Date
): Promise<{
  reportCardJobsCompletedToday: number;
  reportCardJobsFailedToday: number;
  smartTimetableDraftsReady: number;
  smartTimetableJobsFailed: number;
}> {
  const tomorrow = nextDay(dateOnly);
  const [reportCardJobsCompletedToday, reportCardJobsFailedToday, smartTimetableDraftsReady, smartTimetableJobsFailed] = await Promise.all([
    prisma.backgroundJob.count({ where: { schoolId, type: "REPORT_CARD_BATCH_GENERATION", status: "COMPLETED", completedAt: { gte: dateOnly, lt: tomorrow } } }),
    prisma.backgroundJob.count({ where: { schoolId, type: "REPORT_CARD_BATCH_GENERATION", status: "FAILED", updatedAt: { gte: dateOnly, lt: tomorrow } } }),
    prisma.timetableDraft.count({ where: { schoolId, status: "VALID", updatedAt: { gte: dateOnly, lt: tomorrow } } }),
    prisma.backgroundJob.count({ where: { schoolId, type: "SMART_TIMETABLE_GENERATION", status: "FAILED", updatedAt: { gte: dateOnly, lt: tomorrow } } }),
  ]);
  return { reportCardJobsCompletedToday, reportCardJobsFailedToday, smartTimetableDraftsReady, smartTimetableJobsFailed };
}
