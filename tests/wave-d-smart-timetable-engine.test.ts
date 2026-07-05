import { describe, it, expect } from "vitest";
import { calculateWeeklyCapacity, validateSubjectRequirements } from "@/lib/timetable-capacity";
import {
  resolveEffectiveWorkloadRule,
  checkMaxWeeklyWorkload,
  DEFAULT_MAX_CONSECUTIVE_TEACHING_PERIODS,
  type SchoolWorkloadDefaults,
} from "@/lib/teacher-workload-rules";
import {
  isTeacherEligibleForSubject,
  getTeacherWeeklyPeriodCount,
  getTeacherDayPeriods,
  projectedConsecutiveRun,
  isTeacherBusy,
  isSectionSlotFilled,
  reserveSlot,
  type GenerationContext,
  type TeacherInfo,
} from "@/lib/smart-timetable-context";
import { checkHardConstraints, isCandidateValid } from "@/lib/smart-timetable-constraints";
import { scoreSlotCandidate, scoreTeacherRecommendation } from "@/lib/smart-timetable-scoring";
import { computeCompatibleSlots } from "@/lib/smart-timetable-slots";

const SCHOOL_DEFAULTS: SchoolWorkloadDefaults = {
  timetableWorkingDays: 6,
  periodsPerDay: 6,
  defaultMaxWeeklyTeachingPeriods: null,
  defaultMinFreeTeachingPeriods: null,
  defaultMaxDailyTeachingPeriods: null,
  defaultMaxConsecutiveTeachingPeriods: null,
};

function makeTeacher(id: string, overrides: Partial<TeacherInfo> = {}): TeacherInfo {
  return { id, name: `Teacher ${id}`, subject: "Mathematics", eligibleSubjects: new Set(), workloadOverride: null, ...overrides };
}

function makeContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    schoolId: "school-1",
    workingDays: 6,
    periodsPerDay: 6,
    capacity: 36,
    schoolDefaults: SCHOOL_DEFAULTS,
    teachers: new Map(),
    teacherOccupancy: new Map(),
    sectionOccupancy: new Map(),
    ...overrides,
  };
}

describe("timetable capacity (PART 4)", () => {
  it("6 working days x 6 periods = 36 capacity", () => {
    expect(calculateWeeklyCapacity({ timetableWorkingDays: 6, periodsPerDay: 6 })).toBe(36);
  });

  it("exact requirement -> VALID", () => {
    const result = validateSubjectRequirements(36, [{ subjectName: "Maths", requiredPeriodsPerWeek: 36 }]);
    expect(result).toMatchObject({ capacity: 36, required: 36, remaining: 0, status: "VALID" });
    expect(result.issues).toEqual([]);
  });

  it("excess requirement -> EXCESS_REQUIREMENTS with negative remaining", () => {
    const result = validateSubjectRequirements(36, [{ subjectName: "Maths", requiredPeriodsPerWeek: 40 }]);
    expect(result).toMatchObject({ capacity: 36, required: 40, remaining: -4, status: "EXCESS_REQUIREMENTS" });
    expect(result.issues[0].code).toBe("CAPACITY_EXCEEDED");
  });

  it("under requirement -> VALID_WITH_UNASSIGNED with positive remaining", () => {
    const result = validateSubjectRequirements(36, [{ subjectName: "Maths", requiredPeriodsPerWeek: 32 }]);
    expect(result).toMatchObject({ capacity: 36, required: 32, remaining: 4, status: "VALID_WITH_UNASSIGNED" });
    expect(result.issues[0].code).toBe("UNASSIGNED_SLOTS_REMAIN");
  });
});

describe("teacher workload rules (PART 3/8)", () => {
  it("fallback: 6x6 school -> minFree=6, maxWeekly=30 (no config)", () => {
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    expect(rule.minFreeTeachingPeriods).toBe(6);
    expect(rule.maxWeeklyTeachingPeriods).toBe(30);
    expect(rule.maxDailyTeachingPeriods).toBe(6);
    expect(rule.maxConsecutiveTeachingPeriods).toBe(DEFAULT_MAX_CONSECUTIVE_TEACHING_PERIODS);
  });

  it("a different school's own working-days*periods fallback is NOT the universal 30", () => {
    const rule = resolveEffectiveWorkloadRule({ ...SCHOOL_DEFAULTS, timetableWorkingDays: 5, periodsPerDay: 8 }, null);
    expect(rule.minFreeTeachingPeriods).toBe(8);
    expect(rule.maxWeeklyTeachingPeriods).toBe(32); // 40 capacity - 8 minFree
  });

  it("school default overrides the computed fallback", () => {
    const rule = resolveEffectiveWorkloadRule({ ...SCHOOL_DEFAULTS, defaultMaxWeeklyTeachingPeriods: 28 }, null);
    expect(rule.maxWeeklyTeachingPeriods).toBe(28);
  });

  it("teacher override wins over school default", () => {
    const rule = resolveEffectiveWorkloadRule(
      { ...SCHOOL_DEFAULTS, defaultMaxWeeklyTeachingPeriods: 28 },
      { maxWeeklyTeachingPeriods: 24, minFreeTeachingPeriods: null, maxDailyTeachingPeriods: null, maxConsecutiveTeachingPeriods: null }
    );
    expect(rule.maxWeeklyTeachingPeriods).toBe(24);
  });

  it("STRICT: 28 current + 5 requested > 30 max -> rejected", () => {
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const result = checkMaxWeeklyWorkload(28, 5, rule);
    expect(result.allowed).toBe(false);
    expect(result.projectedWeeklyPeriods).toBe(33);
  });

  it("under max is allowed", () => {
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const result = checkMaxWeeklyWorkload(24, 5, rule);
    expect(result.allowed).toBe(true);
    expect(result.remainingCapacity).toBe(6);
  });
});

describe("teacher eligibility (PART 5)", () => {
  it("explicit eligibility rows take precedence", () => {
    const teacher = makeTeacher("t1", { subject: "Science", eligibleSubjects: new Set(["mathematics", "physics"]) });
    expect(isTeacherEligibleForSubject(teacher, "Mathematics")).toBe(true);
    expect(isTeacherEligibleForSubject(teacher, "Science")).toBe(false); // explicit rows override the legacy single-subject field
  });

  it("falls back to legacy Teacher.subject when no explicit rows exist", () => {
    const teacher = makeTeacher("t2", { subject: "English", eligibleSubjects: new Set() });
    expect(isTeacherEligibleForSubject(teacher, "English")).toBe(true);
    expect(isTeacherEligibleForSubject(teacher, "Mathematics")).toBe(false);
  });

  it("cross-school teacher is simply absent from ctx.teachers, so any lookup misses (denied)", () => {
    const ctx = makeContext();
    expect(ctx.teachers.get("outsider")).toBeUndefined();
  });
});

describe("context occupancy helpers", () => {
  it("reserveSlot marks both teacher and section occupancy", () => {
    const ctx = makeContext();
    reserveSlot(ctx, "t1", "sec-A", 1, 1);
    expect(isTeacherBusy(ctx, "t1", 1, 1)).toBe(true);
    expect(isSectionSlotFilled(ctx, "sec-A", 1, 1)).toBe(true);
    expect(isTeacherBusy(ctx, "t1", 1, 2)).toBe(false);
  });

  it("getTeacherWeeklyPeriodCount reflects distinct occupied slots", () => {
    const ctx = makeContext();
    reserveSlot(ctx, "t1", "sec-A", 1, 1);
    reserveSlot(ctx, "t1", "sec-B", 2, 3);
    expect(getTeacherWeeklyPeriodCount(ctx, "t1")).toBe(2);
  });

  it("getTeacherDayPeriods returns sorted periods for one day only", () => {
    const ctx = makeContext();
    reserveSlot(ctx, "t1", "sec-A", 1, 3);
    reserveSlot(ctx, "t1", "sec-A", 1, 1);
    reserveSlot(ctx, "t1", "sec-A", 2, 5);
    expect(getTeacherDayPeriods(ctx, "t1", 1)).toEqual([1, 3]);
  });

  it("projectedConsecutiveRun detects a run including the candidate period", () => {
    const ctx = makeContext();
    reserveSlot(ctx, "t1", "sec-A", 1, 1);
    reserveSlot(ctx, "t1", "sec-A", 1, 2);
    expect(projectedConsecutiveRun(ctx, "t1", 1, 3)).toBe(3);
    // periods {1,2,5}: longest run is still 1-2 (length 2); period 5 is isolated.
    expect(projectedConsecutiveRun(ctx, "t1", 1, 5)).toBe(2);
  });
});

describe("hard constraints H1-H8 (PART 6)", () => {
  it("H1 — teacher already busy at that day/period is rejected", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    reserveSlot(ctx, "t1", "sec-B", 1, 1); // busy elsewhere
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 1, period: 1, subjectName: "Mathematics" }, rule);
    expect(violations.some((v) => v.code === "TEACHER_SLOT_OCCUPIED")).toBe(true);
  });

  it("H1 — teacher free at that day/period is allowed", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 1, period: 1, subjectName: "Mathematics" }, rule);
    expect(violations).toEqual([]);
  });

  it("H2 — duplicate class slot is rejected regardless of teacher", () => {
    const ctx = makeContext();
    reserveSlot(ctx, null, "sec-A", 1, 1);
    const violations = checkHardConstraints(ctx, { teacherId: null, sectionId: "sec-A", day: 1, period: 1, subjectName: "Mathematics" }, null);
    expect(violations.some((v) => v.code === "CLASS_SLOT_OCCUPIED")).toBe(true);
  });

  it("H4 — wrong-subject teacher is denied", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { subject: "Science", eligibleSubjects: new Set() })]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 1, period: 1, subjectName: "Mathematics" }, rule);
    expect(violations.some((v) => v.code === "TEACHER_NOT_ELIGIBLE")).toBe(true);
  });

  it("H5 — projected weekly workload exceeding max is rejected", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    for (let p = 1; p <= 30; p++) {
      const day = Math.ceil(p / 6);
      const period = ((p - 1) % 6) + 1;
      reserveSlot(ctx, "t1", "sec-B", day, period);
    }
    expect(getTeacherWeeklyPeriodCount(ctx, "t1")).toBe(30);
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null); // max 30
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 6, period: 6, subjectName: "Mathematics" }, rule);
    expect(violations.some((v) => v.code === "TEACHER_MAX_WEEKLY_EXCEEDED")).toBe(true);
  });

  it("H6 — placing a period that would drop free periods below minimum is rejected", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    // 30 occupied already (free = 6, at the minimum); one more push below minimum.
    let count = 0;
    outer: for (let day = 1; day <= 6; day++) {
      for (let period = 1; period <= 6; period++) {
        if (count >= 30) break outer;
        reserveSlot(ctx, "t1", "sec-B", day, period);
        count++;
      }
    }
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null); // minFree 6
    // The only free slot left is (6,6)... but H5 will also fire since 31 > 30. Use a school with a looser max to isolate H6.
    const looseRule = resolveEffectiveWorkloadRule({ ...SCHOOL_DEFAULTS, defaultMaxWeeklyTeachingPeriods: 35, defaultMinFreeTeachingPeriods: 6 }, null);
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 6, period: 6, subjectName: "Mathematics" }, looseRule);
    expect(violations.some((v) => v.code === "TEACHER_MIN_FREE_VIOLATED")).toBe(true);
    void rule;
  });

  it("H7 — exceeding max daily periods is rejected", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    for (let period = 1; period <= 6; period++) reserveSlot(ctx, "t1", "sec-B", 1, period);
    const rule = resolveEffectiveWorkloadRule({ ...SCHOOL_DEFAULTS, defaultMaxWeeklyTeachingPeriods: 35, defaultMaxDailyTeachingPeriods: 6 }, null);
    // Day 1 is full (6/6) — any 7th period on day 1 is impossible anyway (periodsPerDay=6), so
    // assert the daily-max check fires using a section with periodsPerDay effectively already maxed.
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 1, period: 6, subjectName: "Mathematics" }, rule);
    // day 1 period 6 is already occupied by sec-B -> H1 fires; test daily max distinctly below.
    expect(violations.some((v) => v.code === "TEACHER_SLOT_OCCUPIED")).toBe(true);
  });

  it("H7 — daily max fires distinctly from H1 when the day is full but the new period is free", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]), periodsPerDay: 7, capacity: 42 });
    for (let period = 1; period <= 6; period++) reserveSlot(ctx, "t1", "sec-B", 1, period);
    const rule = resolveEffectiveWorkloadRule({ ...SCHOOL_DEFAULTS, periodsPerDay: 7, defaultMaxWeeklyTeachingPeriods: 40, defaultMaxDailyTeachingPeriods: 6, defaultMinFreeTeachingPeriods: 0 }, null);
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 1, period: 7, subjectName: "Mathematics" }, rule);
    expect(violations.some((v) => v.code === "TEACHER_MAX_DAILY_EXCEEDED")).toBe(true);
    expect(violations.some((v) => v.code === "TEACHER_SLOT_OCCUPIED")).toBe(false);
  });

  it("H8 — a 5th consecutive period is invalid at the default maximum of 4", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    reserveSlot(ctx, "t1", "sec-B", 1, 1);
    reserveSlot(ctx, "t1", "sec-B", 1, 2);
    reserveSlot(ctx, "t1", "sec-B", 1, 3);
    reserveSlot(ctx, "t1", "sec-B", 1, 4);
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null); // maxConsecutive default 4
    const violations = checkHardConstraints(ctx, { teacherId: "t1", sectionId: "sec-A", day: 1, period: 5, subjectName: "Mathematics" }, rule);
    expect(violations.some((v) => v.code === "TEACHER_MAX_CONSECUTIVE_EXCEEDED")).toBe(true);
  });

  it("isCandidateValid is false whenever any ERROR violation exists", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { subject: "Science", eligibleSubjects: new Set() })]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    expect(isCandidateValid(ctx, { teacherId: "t1", sectionId: "sec-A", day: 1, period: 1, subjectName: "Mathematics" }, rule)).toBe(false);
  });
});

describe("soft scoring determinism (PART 7)", () => {
  it("scoreSlotCandidate is deterministic for identical input", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1")]]) });
    const args = {
      ctx,
      teacherId: "t1",
      subjectName: "Mathematics",
      day: 2,
      period: 3,
      sectionSlots: [{ day: 2, period: 1, subjectName: "Mathematics" }],
      allowConsecutive: false,
      rule: resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null),
    };
    const first = scoreSlotCandidate(args);
    const second = scoreSlotCandidate(args);
    expect(second).toEqual(first);
  });

  it("penalizes a slot that clusters the same subject on the same day", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1")]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const clustered = scoreSlotCandidate({
      ctx, teacherId: "t1", subjectName: "Mathematics", day: 1, period: 2,
      sectionSlots: [{ day: 1, period: 1, subjectName: "Mathematics" }], allowConsecutive: true, rule,
    });
    const spread = scoreSlotCandidate({
      ctx, teacherId: "t1", subjectName: "Mathematics", day: 1, period: 2,
      sectionSlots: [{ day: 3, period: 1, subjectName: "Mathematics" }], allowConsecutive: true, rule,
    });
    expect(clustered.score).toBeLessThan(spread.score);
  });

  it("scoreTeacherRecommendation labels LIMITED_CAPACITY when compatible slots < required", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1")]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const result = scoreTeacherRecommendation({ ctx, teacherId: "t1", requiredPeriods: 6, compatibleSlotCount: 2, rule, alreadyTeachesParallelSection: false });
    expect(result.label).toBe("LIMITED_CAPACITY");
  });

  it("scoreTeacherRecommendation labels HIGH_WORKLOAD when remaining capacity is low", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1")]]) });
    for (let p = 0; p < 29; p++) reserveSlot(ctx, "t1", "sec-B", Math.floor(p / 6) + 1, (p % 6) + 1);
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null); // max 30, so remaining = 1
    const result = scoreTeacherRecommendation({ ctx, teacherId: "t1", requiredPeriods: 2, compatibleSlotCount: 6, rule, alreadyTeachesParallelSection: false });
    expect(result.label).toBe("HIGH_WORKLOAD");
  });

  it("parallel-section continuity adds a bonus and a reason", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1")]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const withBonus = scoreTeacherRecommendation({ ctx, teacherId: "t1", requiredPeriods: 2, compatibleSlotCount: 10, rule, alreadyTeachesParallelSection: true });
    const withoutBonus = scoreTeacherRecommendation({ ctx, teacherId: "t1", requiredPeriods: 2, compatibleSlotCount: 10, rule, alreadyTeachesParallelSection: false });
    expect(withBonus.score).toBeGreaterThan(withoutBonus.score);
    expect(withBonus.reasons.some((r) => r.code === "PARALLEL_SECTION_CONTINUITY")).toBe(true);
  });
});

describe("compatible slot engine (PART 9)", () => {
  it("excludes slots where the teacher is occupied elsewhere", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    reserveSlot(ctx, "t1", "sec-B", 1, 1);
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const { valid } = computeCompatibleSlots({ ctx, teacherId: "t1", sectionId: "sec-A", subjectName: "Mathematics", allowConsecutive: false, sectionSlots: [], rule });
    expect(valid.some((s) => s.day === 1 && s.period === 1)).toBe(false);
  });

  it("excludes slots where the class/section already has a period", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    reserveSlot(ctx, null, "sec-A", 1, 1);
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const { valid } = computeCompatibleSlots({ ctx, teacherId: "t1", sectionId: "sec-A", subjectName: "Mathematics", allowConsecutive: false, sectionSlots: [], rule });
    expect(valid.some((s) => s.day === 1 && s.period === 1)).toBe(false);
  });

  it("returns slots ranked by score descending, deterministic tie-break by day then period", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { eligibleSubjects: new Set(["mathematics"]) })]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const first = computeCompatibleSlots({ ctx, teacherId: "t1", sectionId: "sec-A", subjectName: "Mathematics", allowConsecutive: false, sectionSlots: [], rule });
    const second = computeCompatibleSlots({ ctx, teacherId: "t1", sectionId: "sec-A", subjectName: "Mathematics", allowConsecutive: false, sectionSlots: [], rule });
    expect(second.valid).toEqual(first.valid);
    for (let i = 1; i < first.valid.length; i++) {
      expect(first.valid[i - 1].score).toBeGreaterThanOrEqual(first.valid[i].score);
    }
  });

  it("diagnostic mode reports rejected slots with violations", () => {
    const ctx = makeContext({ teachers: new Map([["t1", makeTeacher("t1", { subject: "Science", eligibleSubjects: new Set() })]]) });
    const rule = resolveEffectiveWorkloadRule(SCHOOL_DEFAULTS, null);
    const { diagnostics } = computeCompatibleSlots({ ctx, teacherId: "t1", sectionId: "sec-A", subjectName: "Mathematics", allowConsecutive: false, sectionSlots: [], rule, includeInvalid: true });
    expect(diagnostics).toBeDefined();
    expect(diagnostics!.every((d) => !d.valid)).toBe(true);
    expect(diagnostics!.some((d) => d.violations.some((v) => v.code === "TEACHER_NOT_ELIGIBLE"))).toBe(true);
  });
});
