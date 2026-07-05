/**
 * School Operations Command Center — lecture coverage engine (PART 10, 11, 12).
 *
 * `classifyTodayLectures` is the SINGLE authoritative classifier — teacher
 * status (Part 5), current-period ops (Part 11), and next-period risk
 * (Part 12) all consume its output rather than re-deriving normal/substituted/
 * uncovered independently.
 *
 * Replacement recommendations reuse `src/lib/teacher-ranking.ts`'s
 * `rankReplacementTeachers` — the DAY-SPECIFIC substitute-selection service
 * already used by `arrangements.ts` — NOT Smart Timetable's
 * `recommendTeachers`, which solves WEEKLY timetable allocation (workload/
 * slot-compatibility across an entire term) and is the wrong tool for "who
 * can cover this one period today."
 */

import type { TodayOperationsContext, ArrangementRow } from "@/lib/operations-context";
import { rankReplacementTeachers } from "@/lib/teacher-ranking";

export type LectureCoverageStatus = "NORMAL" | "SUBSTITUTED" | "UNCOVERED";
export type UnavailabilityReason = "ABSENT" | "ON_LEAVE" | null;

export interface LectureClassification {
  sectionId: string;
  sectionName: string;
  className: string;
  period: number;
  subject: string | null;
  originalTeacherId: string | null;
  effectiveTeacherId: string | null;
  status: LectureCoverageStatus;
  unavailabilityReason: UnavailabilityReason;
}

/**
 * Classifies every scheduled instructional slot for the school-day. A slot
 * counts as "scheduled" (requiring a teacher) only if it has a `subject` —
 * a slot with neither subject nor teacher is an unused/empty timetable cell,
 * not a lecture, and is excluded entirely rather than counted as uncovered.
 * A slot WITH a subject but no assigned teacher is UNCOVERED (PART 10:
 * "do not treat a timetable slot with no teacher as automatically normal").
 */
export function classifyTodayLectures(ctx: TodayOperationsContext): LectureClassification[] {
  const arrangementBySlot = new Map<string, ArrangementRow>();
  for (const a of ctx.todayArrangements) arrangementBySlot.set(`${a.sectionId}-${a.period}`, a);

  const results: LectureClassification[] = [];
  for (const slot of ctx.todaySlots) {
    if (!slot.subject) continue; // not a scheduled lecture — empty timetable cell
    const base = { sectionId: slot.sectionId, sectionName: slot.sectionName, className: slot.className, period: slot.period, subject: slot.subject };

    if (!slot.teacherId) {
      const arrangement = arrangementBySlot.get(`${slot.sectionId}-${slot.period}`);
      if (arrangement?.substituteTeacherId) {
        results.push({ ...base, originalTeacherId: null, effectiveTeacherId: arrangement.substituteTeacherId, status: "SUBSTITUTED", unavailabilityReason: null });
      } else {
        results.push({ ...base, originalTeacherId: null, effectiveTeacherId: null, status: "UNCOVERED", unavailabilityReason: null });
      }
      continue;
    }

    const isAbsent = ctx.teacherAttendance.get(slot.teacherId) === "ABSENT";
    const isOnLeave = ctx.teachersOnLeave.has(slot.teacherId);
    if (!isAbsent && !isOnLeave) {
      results.push({ ...base, originalTeacherId: slot.teacherId, effectiveTeacherId: slot.teacherId, status: "NORMAL", unavailabilityReason: null });
      continue;
    }

    const reason: UnavailabilityReason = isAbsent ? "ABSENT" : "ON_LEAVE";
    const arrangement = arrangementBySlot.get(`${slot.sectionId}-${slot.period}`);
    if (arrangement?.substituteTeacherId) {
      results.push({ ...base, originalTeacherId: slot.teacherId, effectiveTeacherId: arrangement.substituteTeacherId, status: "SUBSTITUTED", unavailabilityReason: reason });
    } else {
      results.push({ ...base, originalTeacherId: slot.teacherId, effectiveTeacherId: null, status: "UNCOVERED", unavailabilityReason: reason });
    }
  }
  return results;
}

export interface CoverageTotals {
  scheduled: number;
  normal: number;
  substituted: number;
  uncovered: number;
  coveragePercentage: number | null;
}

export function summarizeCoverage(lectures: LectureClassification[]): CoverageTotals {
  const scheduled = lectures.length;
  const normal = lectures.filter((l) => l.status === "NORMAL").length;
  const substituted = lectures.filter((l) => l.status === "SUBSTITUTED").length;
  const uncovered = lectures.filter((l) => l.status === "UNCOVERED").length;
  const coveragePercentage = scheduled > 0 ? Math.round(((normal + substituted) / scheduled) * 1000) / 10 : null;
  return { scheduled, normal, substituted, uncovered, coveragePercentage };
}

export interface UncoveredLectureDetail {
  period: number;
  className: string;
  sectionName: string;
  subject: string | null;
  originalTeacherId: string | null;
  originalTeacherName: string | null;
  unavailabilityReason: UnavailabilityReason;
  topRecommendations: { teacherId: string; teacherName: string }[];
}

const RECOMMENDATION_LIMIT = 3;

export async function describeUncoveredLectures(
  ctx: TodayOperationsContext,
  lectures: LectureClassification[]
): Promise<UncoveredLectureDetail[]> {
  const uncovered = lectures.filter((l) => l.status === "UNCOVERED");
  const details: UncoveredLectureDetail[] = [];
  for (const lecture of uncovered) {
    const recommendations = await rankReplacementTeachers(ctx.schoolId, lecture.subject, lecture.originalTeacherId ?? undefined);
    details.push({
      period: lecture.period,
      className: lecture.className,
      sectionName: lecture.sectionName,
      subject: lecture.subject,
      originalTeacherId: lecture.originalTeacherId,
      originalTeacherName: lecture.originalTeacherId ? (ctx.teachers.get(lecture.originalTeacherId)?.name ?? null) : null,
      unavailabilityReason: lecture.unavailabilityReason,
      topRecommendations: recommendations.slice(0, RECOMMENDATION_LIMIT).map((r) => ({ teacherId: r.id, teacherName: r.name })),
    });
  }
  return details;
}

// ── Current period operations (PART 11) ───────────────────────────────────────
export interface CurrentPeriodOperations {
  status: string;
  periodNumber: number | null;
  label: string | null;
  runningClasses: number;
  normal: number;
  substituted: number;
  uncovered: number;
  teachersInClass: number;
  teachersFree: number;
  teachersUnavailable: number;
  uncoveredDetails: UncoveredLectureDetail[];
}

export async function computeCurrentPeriodOperations(ctx: TodayOperationsContext, allLectures: LectureClassification[]): Promise<CurrentPeriodOperations> {
  const status = ctx.periodState.status;
  const currentPeriodNumber = ctx.periodState.currentPeriod?.periodNumber ?? null;

  if (currentPeriodNumber === null) {
    return {
      status,
      periodNumber: null,
      label: null,
      runningClasses: 0,
      normal: 0,
      substituted: 0,
      uncovered: 0,
      teachersInClass: 0,
      teachersFree: 0,
      teachersUnavailable: 0,
      uncoveredDetails: [],
    };
  }

  const currentLectures = allLectures.filter((l) => l.period === currentPeriodNumber);
  const totals = summarizeCoverage(currentLectures);
  const uncoveredDetails = await describeUncoveredLectures(ctx, currentLectures);

  const inClassTeacherIds = new Set(currentLectures.map((l) => l.effectiveTeacherId).filter((id): id is string => Boolean(id)));
  let teachersUnavailable = 0;
  let teachersFree = 0;
  for (const [teacherId] of ctx.teachers) {
    if (inClassTeacherIds.has(teacherId)) continue;
    const isAbsent = ctx.teacherAttendance.get(teacherId) === "ABSENT";
    const isOnLeave = ctx.teachersOnLeave.has(teacherId);
    if (isAbsent || isOnLeave) teachersUnavailable++;
    else teachersFree++;
  }

  return {
    status,
    periodNumber: currentPeriodNumber,
    label: ctx.periodState.currentPeriod?.label ?? null,
    runningClasses: totals.scheduled,
    normal: totals.normal,
    substituted: totals.substituted,
    uncovered: totals.uncovered,
    teachersInClass: inClassTeacherIds.size,
    teachersFree,
    teachersUnavailable,
    uncoveredDetails,
  };
}

// ── Next period risk (PART 12) ────────────────────────────────────────────────
export type RiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Named risk thresholds (uncovered-lecture count) — deliberate, documented, not scattered. */
export const NEXT_PERIOD_RISK_THRESHOLDS = {
  MEDIUM_AT: 1,
  HIGH_AT: 2,
  HIGH_MAX: 3,
  CRITICAL_AT: 4,
} as const;

export function classifyRiskLevel(uncoveredCount: number, substitutedCount: number): RiskLevel {
  if (uncoveredCount >= NEXT_PERIOD_RISK_THRESHOLDS.CRITICAL_AT) return "CRITICAL";
  if (uncoveredCount >= NEXT_PERIOD_RISK_THRESHOLDS.HIGH_AT) return "HIGH";
  if (uncoveredCount >= NEXT_PERIOD_RISK_THRESHOLDS.MEDIUM_AT) return "MEDIUM";
  if (substitutedCount > 0) return "LOW";
  return "NONE";
}

export interface NextPeriodRisk {
  hasNextPeriod: boolean;
  periodNumber: number | null;
  label: string | null;
  startTime: string | null;
  startsInMinutes: number | null;
  scheduled: number;
  unavailableTeacherLectures: number;
  covered: number;
  uncovered: number;
  riskLevel: RiskLevel;
  uncoveredDetails: UncoveredLectureDetail[];
}

function minutesBetween(nowHHMM: string, targetHHMM: string): number | null {
  const [nh, nm] = nowHHMM.split(":").map(Number);
  const [th, tm] = targetHHMM.split(":").map(Number);
  const diff = th * 60 + tm - (nh * 60 + nm);
  return diff >= 0 ? diff : null;
}

export async function computeNextPeriodRisk(ctx: TodayOperationsContext, allLectures: LectureClassification[]): Promise<NextPeriodRisk> {
  const next = ctx.periodState.nextPeriod;
  if (!next) {
    return {
      hasNextPeriod: false, periodNumber: null, label: null, startTime: null, startsInMinutes: null,
      scheduled: 0, unavailableTeacherLectures: 0, covered: 0, uncovered: 0, riskLevel: "NONE", uncoveredDetails: [],
    };
  }

  const nextLectures = allLectures.filter((l) => l.period === next.periodNumber);
  const totals = summarizeCoverage(nextLectures);
  const unavailableTeacherLectures = totals.substituted + totals.uncovered;
  const uncoveredDetails = await describeUncoveredLectures(ctx, nextLectures);
  const riskLevel = classifyRiskLevel(totals.uncovered, totals.substituted);

  return {
    hasNextPeriod: true,
    periodNumber: next.periodNumber,
    label: next.label,
    startTime: next.startTime,
    startsInMinutes: minutesBetween(ctx.timeOfDay, next.startTime),
    scheduled: totals.scheduled,
    unavailableTeacherLectures,
    covered: totals.substituted,
    uncovered: totals.uncovered,
    riskLevel,
    uncoveredDetails,
  };
}
