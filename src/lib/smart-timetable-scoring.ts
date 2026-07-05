/**
 * Smart Timetable — deterministic soft-constraint scoring (PART 7).
 *
 * Hard constraints (smart-timetable-constraints.ts) can never be violated;
 * everything here only influences ranking/score. All weights are named
 * constants — no magic numbers scattered through the scoring logic.
 *
 * S3 (teacher daily load balance) and S5 (free period distribution) are
 * deliberately combined into one "daily balance" measure below: preferring an
 * even per-day teacher load is mathematically the same objective as avoiding
 * clustering free periods — scoring them as two independent components would
 * double-count the same underlying signal.
 */

import type { EffectiveWorkloadRule } from "@/lib/teacher-workload-rules";
import { type GenerationContext, getTeacherDayPeriods, projectedConsecutiveRun } from "@/lib/smart-timetable-context";

export const SLOT_SCORE_WEIGHTS = {
  BASE: 100,
  SUBJECT_DAY_SPREAD_PENALTY: 20, // S1, per extra same-subject period already on that day
  SAME_SUBJECT_CONSECUTIVE_PENALTY: 15, // S2
  TEACHER_DAILY_BALANCE_MAX_PENALTY: 15, // S3 + S5 combined
  TEACHER_CONSECUTIVE_LOAD_MAX_PENALTY: 15, // S4
  LATE_PERIOD_PENALTY: 5, // S7 (generic: avoid the school day's final period)
  WORKLOAD_HEADROOM_MAX_BONUS: 5, // S8
} as const;

export interface ScoreReason {
  code: string;
  message: string;
}

export interface SlotScoreBreakdown {
  score: number;
  reasons: ScoreReason[];
  warnings: ScoreReason[];
}

export function scoreSlotCandidate(args: {
  ctx: GenerationContext;
  teacherId: string;
  subjectName: string;
  day: number;
  period: number;
  /** This section's OWN existing draft slots, excluding the one being scored. */
  sectionSlots: { day: number; period: number; subjectName: string | null }[];
  allowConsecutive: boolean;
  rule: EffectiveWorkloadRule;
}): SlotScoreBreakdown {
  const { ctx, teacherId, subjectName, day, period, sectionSlots, allowConsecutive, rule } = args;
  const reasons: ScoreReason[] = [];
  const warnings: ScoreReason[] = [];
  let score = SLOT_SCORE_WEIGHTS.BASE;

  // S1 — subject weekly distribution: penalize extra same-subject periods
  // already scheduled on this day for this section.
  const sameSubjectSameDay = sectionSlots.filter(
    (s) => s.day === day && s.subjectName?.trim().toLowerCase() === subjectName.trim().toLowerCase()
  ).length;
  if (sameSubjectSameDay > 0) {
    score -= sameSubjectSameDay * SLOT_SCORE_WEIGHTS.SUBJECT_DAY_SPREAD_PENALTY;
    warnings.push({
      code: "SUBJECT_ALREADY_ON_DAY",
      message: `${subjectName} is already scheduled ${sameSubjectSameDay} time(s) on this day.`,
    });
  } else {
    reasons.push({ code: "SUBJECT_DAY_SPREAD_OK", message: `${subjectName} not yet scheduled on this day.` });
  }

  // S2 — avoid same-subject consecutive periods unless explicitly allowed.
  const adjacentSameSubject = sectionSlots.some(
    (s) => s.day === day && (s.period === period - 1 || s.period === period + 1) &&
      s.subjectName?.trim().toLowerCase() === subjectName.trim().toLowerCase()
  );
  if (adjacentSameSubject && !allowConsecutive) {
    score -= SLOT_SCORE_WEIGHTS.SAME_SUBJECT_CONSECUTIVE_PENALTY;
    warnings.push({ code: "SUBJECT_CONSECUTIVE_PERIOD", message: `${subjectName} would be consecutive with an adjacent period.` });
  }

  // S3 + S5 — teacher daily load balance (proxy for free-period distribution).
  const dayPeriods = getTeacherDayPeriods(ctx, teacherId, day);
  const dailyBalanceRatio = ctx.periodsPerDay > 0 ? dayPeriods.length / ctx.periodsPerDay : 0;
  const dailyBalancePenalty = Math.round(dailyBalanceRatio * SLOT_SCORE_WEIGHTS.TEACHER_DAILY_BALANCE_MAX_PENALTY);
  score -= dailyBalancePenalty;
  if (dailyBalancePenalty > 0) {
    warnings.push({ code: "TEACHER_DAY_ALREADY_LOADED", message: "Teacher already has several periods on this day." });
  } else {
    reasons.push({ code: "TEACHER_DAY_BALANCED", message: "Teacher's day is not overloaded." });
  }

  // S4 — teacher consecutive load (even below the hard maximum, prefer fewer streaks).
  const consecutiveRun = projectedConsecutiveRun(ctx, teacherId, day, period);
  if (consecutiveRun > 1) {
    const penalty = Math.min(
      SLOT_SCORE_WEIGHTS.TEACHER_CONSECUTIVE_LOAD_MAX_PENALTY,
      Math.round(((consecutiveRun - 1) / Math.max(1, rule.maxConsecutiveTeachingPeriods)) * SLOT_SCORE_WEIGHTS.TEACHER_CONSECUTIVE_LOAD_MAX_PENALTY)
    );
    score -= penalty;
    if (penalty > 0) warnings.push({ code: "TEACHER_CONSECUTIVE_RUN", message: `Teacher would have ${consecutiveRun} consecutive periods.` });
  }

  // S7 — generic avoidance of the day's final period (restrained: no subject-specific rule).
  if (period === ctx.periodsPerDay) {
    score -= SLOT_SCORE_WEIGHTS.LATE_PERIOD_PENALTY;
    warnings.push({ code: "FINAL_PERIOD_OF_DAY", message: "This is the last period of the day." });
  }

  // S8 — workload headroom bonus (prefer teachers with more remaining capacity).
  const currentWeekly = ctx.teacherOccupancy.get(teacherId)?.size ?? 0;
  const remaining = rule.maxWeeklyTeachingPeriods - currentWeekly;
  const headroomRatio = rule.maxWeeklyTeachingPeriods > 0 ? Math.max(0, remaining) / rule.maxWeeklyTeachingPeriods : 0;
  score += Math.round(headroomRatio * SLOT_SCORE_WEIGHTS.WORKLOAD_HEADROOM_MAX_BONUS);

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, warnings };
}

export const RECOMMENDATION_WEIGHTS = {
  BASE: 50,
  COMPATIBLE_SLOTS_MAX_BONUS: 25,
  WORKLOAD_HEADROOM_MAX_BONUS: 15,
  PARALLEL_SECTION_BONUS: 10,
  DAILY_BALANCE_MAX_BONUS: 10,
  HIGH_WORKLOAD_REMAINING_THRESHOLD: 2,
} as const;

export type RecommendationLabel = "BEST_MATCH" | "GOOD_MATCH" | "LIMITED_CAPACITY" | "HIGH_WORKLOAD";

export interface TeacherRecommendationScore {
  score: number;
  label: RecommendationLabel;
  reasons: ScoreReason[];
  warnings: ScoreReason[];
}

/**
 * Scores one eligible teacher for a subject/section assignment (PART 8).
 * `compatibleSlotCount` and `alreadyTeachesParallelSection` are precomputed by
 * the caller (compatible-slot engine / parallel-section lookup) to keep this
 * function a pure aggregator.
 */
export function scoreTeacherRecommendation(args: {
  ctx: GenerationContext;
  teacherId: string;
  requiredPeriods: number;
  compatibleSlotCount: number;
  rule: EffectiveWorkloadRule;
  alreadyTeachesParallelSection: boolean;
}): TeacherRecommendationScore {
  const { ctx, teacherId, requiredPeriods, compatibleSlotCount, rule, alreadyTeachesParallelSection } = args;
  const reasons: ScoreReason[] = [];
  const warnings: ScoreReason[] = [];

  const currentWeekly = ctx.teacherOccupancy.get(teacherId)?.size ?? 0;
  const remaining = rule.maxWeeklyTeachingPeriods - currentWeekly;

  let score = RECOMMENDATION_WEIGHTS.BASE;

  const slotRatio = requiredPeriods > 0 ? Math.min(1, compatibleSlotCount / requiredPeriods) : 1;
  score += slotRatio * RECOMMENDATION_WEIGHTS.COMPATIBLE_SLOTS_MAX_BONUS;
  reasons.push({ code: "COMPATIBLE_SLOTS", message: `${compatibleSlotCount} compatible timetable slot(s) available.` });

  const headroomRatio = rule.maxWeeklyTeachingPeriods > 0 ? Math.max(0, remaining) / rule.maxWeeklyTeachingPeriods : 0;
  score += headroomRatio * RECOMMENDATION_WEIGHTS.WORKLOAD_HEADROOM_MAX_BONUS;
  reasons.push({ code: "WORKLOAD_CAPACITY", message: `${Math.max(0, remaining)} weekly workload period(s) available.` });

  if (alreadyTeachesParallelSection) {
    score += RECOMMENDATION_WEIGHTS.PARALLEL_SECTION_BONUS;
    reasons.push({ code: "PARALLEL_SECTION_CONTINUITY", message: "Already teaches this subject in a parallel section." });
  }

  // Daily balance bonus: prefer teachers whose current week is already spread
  // across more distinct days (fewer periods concentrated on fewer days).
  const daysUsed = new Set<number>();
  for (const key of ctx.teacherOccupancy.get(teacherId) ?? []) daysUsed.add(Number(key.split("-")[0]));
  const spreadRatio = ctx.workingDays > 0 ? daysUsed.size / ctx.workingDays : 0;
  score += spreadRatio * RECOMMENDATION_WEIGHTS.DAILY_BALANCE_MAX_BONUS;

  let label: RecommendationLabel;
  if (compatibleSlotCount < requiredPeriods) {
    label = "LIMITED_CAPACITY";
    warnings.push({ code: "INSUFFICIENT_COMPATIBLE_SLOTS", message: `Only ${compatibleSlotCount} compatible slot(s) for ${requiredPeriods} required period(s).` });
  } else if (remaining <= RECOMMENDATION_WEIGHTS.HIGH_WORKLOAD_REMAINING_THRESHOLD) {
    label = "HIGH_WORKLOAD";
    warnings.push({ code: "HIGH_WORKLOAD", message: `Only ${Math.max(0, remaining)} weekly workload period(s) remaining.` });
  } else if (score >= 85) {
    label = "BEST_MATCH";
  } else {
    label = "GOOD_MATCH";
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), label, reasons, warnings };
}
