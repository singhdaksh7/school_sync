/**
 * Smart Timetable — effective teacher workload rule resolution (PART 3 / PART 8).
 * Pure/no-DB: callers batch-load the school + optional per-teacher override row
 * and pass them in here (see smart-timetable-context.ts for the batched loader).
 *
 * Resolution order per field: teacher override -> school default -> computed
 * fallback. Never hardcodes one universal number — the fallback is derived
 * from the school's OWN working-days * periods-per-day, so a school running
 * 5 days x 8 periods gets a different fallback than the 6x6 example school.
 */

/** Fallback max consecutive teaching periods when neither the school nor the teacher configures one. Named/documented, not scattered — matches the product example ("a fifth consecutive period must be invalid"). */
export const DEFAULT_MAX_CONSECUTIVE_TEACHING_PERIODS = 4;

export interface SchoolWorkloadDefaults {
  timetableWorkingDays: number;
  periodsPerDay: number;
  defaultMaxWeeklyTeachingPeriods: number | null;
  defaultMinFreeTeachingPeriods: number | null;
  defaultMaxDailyTeachingPeriods: number | null;
  defaultMaxConsecutiveTeachingPeriods: number | null;
}

export interface TeacherWorkloadOverrideFields {
  maxWeeklyTeachingPeriods: number | null;
  minFreeTeachingPeriods: number | null;
  maxDailyTeachingPeriods: number | null;
  maxConsecutiveTeachingPeriods: number | null;
}

export interface EffectiveWorkloadRule {
  maxWeeklyTeachingPeriods: number;
  minFreeTeachingPeriods: number;
  maxDailyTeachingPeriods: number;
  maxConsecutiveTeachingPeriods: number;
}

/**
 * Resolves the effective workload rule for one teacher.
 *
 * Fallback derivation (only used when a field is unset at both the teacher
 * and school level):
 *   - minFreeTeachingPeriods  -> one day's worth of periods (periodsPerDay)
 *   - maxWeeklyTeachingPeriods -> capacity - effective minFree
 *   - maxDailyTeachingPeriods  -> periodsPerDay (physically cannot exceed it)
 *   - maxConsecutiveTeachingPeriods -> DEFAULT_MAX_CONSECUTIVE_TEACHING_PERIODS
 *
 * This reproduces the product example exactly: 6 days x 6 periods = 36
 * capacity, minFree fallback = 6, maxWeekly fallback = 36 - 6 = 30.
 */
export function resolveEffectiveWorkloadRule(
  school: SchoolWorkloadDefaults,
  override: TeacherWorkloadOverrideFields | null
): EffectiveWorkloadRule {
  const capacity = school.timetableWorkingDays * school.periodsPerDay;

  const minFreeTeachingPeriods =
    override?.minFreeTeachingPeriods ?? school.defaultMinFreeTeachingPeriods ?? school.periodsPerDay;

  const maxWeeklyTeachingPeriods =
    override?.maxWeeklyTeachingPeriods ?? school.defaultMaxWeeklyTeachingPeriods ?? capacity - minFreeTeachingPeriods;

  const maxDailyTeachingPeriods =
    override?.maxDailyTeachingPeriods ?? school.defaultMaxDailyTeachingPeriods ?? school.periodsPerDay;

  const maxConsecutiveTeachingPeriods =
    override?.maxConsecutiveTeachingPeriods ??
    school.defaultMaxConsecutiveTeachingPeriods ??
    DEFAULT_MAX_CONSECUTIVE_TEACHING_PERIODS;

  return { maxWeeklyTeachingPeriods, minFreeTeachingPeriods, maxDailyTeachingPeriods, maxConsecutiveTeachingPeriods };
}

export interface WorkloadCheckResult {
  allowed: boolean;
  projectedWeeklyPeriods: number;
  maxWeeklyTeachingPeriods: number;
  remainingCapacity: number;
}

/**
 * STRICT-mode check for H5 (max weekly workload): does adding
 * `additionalPeriods` to a teacher's current load stay within the effective
 * maximum? The safe default — no WARNING/OVERRIDE bypass is implemented here;
 * callers that want that must do so explicitly above this function.
 */
export function checkMaxWeeklyWorkload(
  currentWeeklyPeriods: number,
  additionalPeriods: number,
  rule: EffectiveWorkloadRule
): WorkloadCheckResult {
  const projectedWeeklyPeriods = currentWeeklyPeriods + additionalPeriods;
  return {
    allowed: projectedWeeklyPeriods <= rule.maxWeeklyTeachingPeriods,
    projectedWeeklyPeriods,
    maxWeeklyTeachingPeriods: rule.maxWeeklyTeachingPeriods,
    remainingCapacity: rule.maxWeeklyTeachingPeriods - currentWeeklyPeriods,
  };
}
