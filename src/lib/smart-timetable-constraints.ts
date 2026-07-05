/**
 * Smart Timetable — deterministic hard constraint engine (PART 6).
 *
 * Checks a SINGLE candidate assignment against the in-memory generation
 * context. Structured results only — never a thrown string (PART 6, PART 24).
 *
 * Scope decisions (see docs/smart-timetable-architecture.md):
 *   - H3 (subject required period count) is a DRAFT-level aggregate check,
 *     not a single-assignment check — see smart-timetable-validation.ts.
 *   - H9 (blocked/unavailable teacher periods): SchoolSync has no persisted
 *     WEEKLY teacher-availability-restriction concept — only day-specific
 *     Attendance/LeaveRequest/TeacherEarlyLeaveRequest rows, which already
 *     drive the separate substitution/arrangement system (src/lib/arrangements.ts)
 *     for one-off daily absence. Weekly recurring Smart Timetable generation
 *     deliberately does NOT consult day-specific absence records — conflating
 *     the two would treat a single sick day as a permanent schedule change.
 *     Not implemented; documented as a deliberate scope boundary, not an
 *     oversight.
 *   - H10 (locked slot) is enforced at the draft-slot mutation layer
 *     (smart-timetable-drafts.ts), not here — it's a property of an existing
 *     slot being overwritten, not of a fresh candidate.
 *   - H11 (fixed school/class periods e.g. assembly/lunch): no such concept
 *     exists in the current timetable schema; not invented per instructions.
 *   - H12 (tenant) is enforced at the API layer via src/lib/tenant.ts helpers
 *     before any of these pure functions ever run.
 */

import type { EffectiveWorkloadRule } from "@/lib/teacher-workload-rules";
import {
  type GenerationContext,
  isTeacherBusy,
  isSectionSlotFilled,
  isTeacherEligibleForSubject,
  getTeacherWeeklyPeriodCount,
  getTeacherDayPeriods,
  projectedConsecutiveRun,
} from "@/lib/smart-timetable-context";

export type ConstraintSeverity = "ERROR" | "WARNING";

export interface ConstraintViolation {
  code: string;
  severity: ConstraintSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AssignmentCandidate {
  teacherId: string | null;
  sectionId: string;
  day: number;
  period: number;
  subjectName: string;
}

/**
 * Runs every applicable single-assignment hard constraint. `rule` is the
 * candidate teacher's already-resolved effective workload rule (see
 * teacher-workload-rules.ts) — omit when teacherId is null (an unassigned
 * placeholder slot only needs the class-slot-conflict check).
 */
export function checkHardConstraints(
  ctx: GenerationContext,
  candidate: AssignmentCandidate,
  rule: EffectiveWorkloadRule | null
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const { teacherId, sectionId, day, period, subjectName } = candidate;

  // H2 — class/section slot conflict (applies regardless of teacher).
  if (isSectionSlotFilled(ctx, sectionId, day, period)) {
    violations.push({
      code: "CLASS_SLOT_OCCUPIED",
      severity: "ERROR",
      message: `This section already has a period scheduled on day ${day}, period ${period}.`,
      metadata: { sectionId, day, period },
    });
  }

  if (!teacherId) return violations;

  const teacher = ctx.teachers.get(teacherId);
  if (!teacher) {
    violations.push({
      code: "TEACHER_NOT_FOUND",
      severity: "ERROR",
      message: "Teacher does not belong to this school.",
      metadata: { teacherId },
    });
    return violations;
  }

  // H1 — teacher double booking (live timetable + batch draft occupancy).
  if (isTeacherBusy(ctx, teacherId, day, period)) {
    violations.push({
      code: "TEACHER_SLOT_OCCUPIED",
      severity: "ERROR",
      message: `${teacher.name} is already teaching another class at day ${day}, period ${period}.`,
      metadata: { teacherId, day, period },
    });
  }

  // H4 — teacher eligibility.
  if (!isTeacherEligibleForSubject(teacher, subjectName)) {
    violations.push({
      code: "TEACHER_NOT_ELIGIBLE",
      severity: "ERROR",
      message: `${teacher.name} is not eligible to teach ${subjectName}.`,
      metadata: { teacherId, subjectName },
    });
  }

  if (rule) {
    const currentWeekly = getTeacherWeeklyPeriodCount(ctx, teacherId);
    const projectedWeekly = currentWeekly + 1;

    // H5 — maximum weekly teacher workload (STRICT: reject over the effective max).
    if (projectedWeekly > rule.maxWeeklyTeachingPeriods) {
      violations.push({
        code: "TEACHER_MAX_WEEKLY_EXCEEDED",
        severity: "ERROR",
        message: `${teacher.name} would exceed the maximum weekly workload (${projectedWeekly}/${rule.maxWeeklyTeachingPeriods}).`,
        metadata: { teacherId, projectedWeekly, maxWeeklyTeachingPeriods: rule.maxWeeklyTeachingPeriods },
      });
    }

    // H6 — minimum weekly free periods. Free periods are computed against the
    // teacher's own timetable universe (the same weekly slot grid as any
    // class — see docs), never double-counted outside it.
    const projectedFree = ctx.capacity - projectedWeekly;
    if (projectedFree < rule.minFreeTeachingPeriods) {
      violations.push({
        code: "TEACHER_MIN_FREE_VIOLATED",
        severity: "ERROR",
        message: `${teacher.name} would drop below the minimum ${rule.minFreeTeachingPeriods} free weekly periods (would have ${projectedFree}).`,
        metadata: { teacherId, projectedFree, minFreeTeachingPeriods: rule.minFreeTeachingPeriods },
      });
    }

    // H7 — maximum daily teaching periods.
    const dayPeriods = getTeacherDayPeriods(ctx, teacherId, day);
    if (dayPeriods.length + 1 > rule.maxDailyTeachingPeriods) {
      violations.push({
        code: "TEACHER_MAX_DAILY_EXCEEDED",
        severity: "ERROR",
        message: `${teacher.name} would exceed the maximum daily periods (${dayPeriods.length + 1}/${rule.maxDailyTeachingPeriods}) on day ${day}.`,
        metadata: { teacherId, day, maxDailyTeachingPeriods: rule.maxDailyTeachingPeriods },
      });
    }

    // H8 — maximum consecutive teaching periods.
    const consecutiveRun = projectedConsecutiveRun(ctx, teacherId, day, period);
    if (consecutiveRun > rule.maxConsecutiveTeachingPeriods) {
      violations.push({
        code: "TEACHER_MAX_CONSECUTIVE_EXCEEDED",
        severity: "ERROR",
        message: `${teacher.name} would have ${consecutiveRun} consecutive periods on day ${day} (maximum ${rule.maxConsecutiveTeachingPeriods}).`,
        metadata: { teacherId, day, consecutiveRun, maxConsecutiveTeachingPeriods: rule.maxConsecutiveTeachingPeriods },
      });
    }
  }

  return violations;
}

export function isCandidateValid(ctx: GenerationContext, candidate: AssignmentCandidate, rule: EffectiveWorkloadRule | null): boolean {
  return checkHardConstraints(ctx, candidate, rule).every((v) => v.severity !== "ERROR");
}
