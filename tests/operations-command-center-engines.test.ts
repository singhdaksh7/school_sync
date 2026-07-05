import { describe, it, expect } from "vitest";
import {
  resolveSchoolLocalNow,
  schoolDbDayOfWeek,
  isWorkingDay,
  schoolLocalDateOnly,
  resolveCurrentPeriod,
  type SchoolPeriodRow,
} from "@/lib/school-time";
import type { TodayOperationsContext, TeacherRosterRow, TimetableSlotRow } from "@/lib/operations-context";
import { classifyTodayLectures, summarizeCoverage, classifyRiskLevel, computeCurrentPeriodOperations, computeNextPeriodRisk, NEXT_PERIOD_RISK_THRESHOLDS, type UncoveredLectureDetail } from "@/lib/operations-lecture-coverage";
import { computeTeacherTodayStatuses, summarizeTeacherStatuses, filterAndPaginateTeacherStatuses } from "@/lib/operations-teacher-status";
import { computeTeacherWorkloadToday, LIGHT_LOAD_MAX_PERIODS } from "@/lib/operations-teacher-workload";
import { computeNeedsAttention, type NeedsAttentionInputs } from "@/lib/operations-attention";
import { computeOperationsHealth } from "@/lib/operations-health";
import type { SchoolWorkloadDefaults, TeacherWorkloadOverrideFields } from "@/lib/teacher-workload-rules";

// ── PART 3: school-local time / period resolution ────────────────────────────
describe("school-time — resolveSchoolLocalNow", () => {
  it("derives dateKey/timeOfDay/weekday from an IANA timezone, not server-local time", () => {
    // 2026-01-05 18:35 UTC is 2026-01-06 00:05 IST (Asia/Kolkata, +5:30) — crosses midnight.
    const now = new Date("2026-01-05T18:35:00.000Z");
    const result = resolveSchoolLocalNow("Asia/Kolkata", now);
    expect(result.dateKey).toBe("2026-01-06");
    expect(result.timeOfDay).toBe("00:05");
    expect(result.jsWeekday).toBe(2); // 2026-01-06 is a Tuesday
  });
});

describe("school-time — schoolDbDayOfWeek / isWorkingDay", () => {
  it("maps Sunday (0) to null (always closed)", () => {
    expect(schoolDbDayOfWeek(0)).toBeNull();
  });
  it("maps Mon..Sat (1..6) straight through", () => {
    for (let d = 1; d <= 6; d++) expect(schoolDbDayOfWeek(d)).toBe(d);
  });
  it("a 5-day school treats day 6 (Saturday) as non-working", () => {
    expect(isWorkingDay(6, 5)).toBe(false);
    expect(isWorkingDay(5, 5)).toBe(true);
  });
  it("null dbDay (Sunday) is never a working day regardless of timetableWorkingDays", () => {
    expect(isWorkingDay(null, 6)).toBe(false);
  });
});

describe("school-time — schoolLocalDateOnly", () => {
  it("builds a local midnight Date from a dateKey", () => {
    const d = schoolLocalDateOnly("2026-03-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
});

const PERIODS: SchoolPeriodRow[] = [
  { periodNumber: 1, label: "P1", startTime: "08:00", endTime: "08:45", isInstructional: true },
  { periodNumber: 2, label: "P2", startTime: "08:45", endTime: "09:30", isInstructional: true },
  { periodNumber: 3, label: "P3", startTime: "09:30", endTime: "10:15", isInstructional: true },
];

describe("school-time — resolveCurrentPeriod (6 named states)", () => {
  it("NON_WORKING_DAY when dbDay exceeds timetableWorkingDays", () => {
    const r = resolveCurrentPeriod({ timeOfDay: "09:00", dbDay: 6, timetableWorkingDays: 5, periods: PERIODS });
    expect(r.status).toBe("NON_WORKING_DAY");
    expect(r.currentPeriod).toBeNull();
  });
  it("NOT_CONFIGURED when no period schedule rows exist at all", () => {
    const r = resolveCurrentPeriod({ timeOfDay: "09:00", dbDay: 1, timetableWorkingDays: 6, periods: [] });
    expect(r.status).toBe("NOT_CONFIGURED");
  });
  it("BEFORE_SCHOOL before the first period's start", () => {
    const r = resolveCurrentPeriod({ timeOfDay: "07:30", dbDay: 1, timetableWorkingDays: 6, periods: PERIODS });
    expect(r.status).toBe("BEFORE_SCHOOL");
    expect(r.nextPeriod?.periodNumber).toBe(1);
  });
  it("IN_PERIOD during an instructional window, with the correct next period", () => {
    const r = resolveCurrentPeriod({ timeOfDay: "08:50", dbDay: 1, timetableWorkingDays: 6, periods: PERIODS });
    expect(r.status).toBe("IN_PERIOD");
    expect(r.currentPeriod?.periodNumber).toBe(2);
    expect(r.nextPeriod?.periodNumber).toBe(3);
  });
  it("AFTER_SCHOOL at/after the last period's end", () => {
    const r = resolveCurrentPeriod({ timeOfDay: "10:15", dbDay: 1, timetableWorkingDays: 6, periods: PERIODS });
    expect(r.status).toBe("AFTER_SCHOOL");
    expect(r.nextPeriod).toBeNull();
  });
  it("BETWEEN_PERIODS in a gap not covered by any period's own range", () => {
    const gappy: SchoolPeriodRow[] = [
      { periodNumber: 1, label: "P1", startTime: "08:00", endTime: "08:45", isInstructional: true },
      { periodNumber: 2, label: "P2", startTime: "09:00", endTime: "09:45", isInstructional: true },
    ];
    const r = resolveCurrentPeriod({ timeOfDay: "08:50", dbDay: 1, timetableWorkingDays: 6, periods: gappy });
    expect(r.status).toBe("BETWEEN_PERIODS");
    expect(r.nextPeriod?.periodNumber).toBe(2);
  });
});

// ── Shared context fixture builder ────────────────────────────────────────────
const SCHOOL_WORKLOAD_DEFAULTS: SchoolWorkloadDefaults = {
  timetableWorkingDays: 6,
  periodsPerDay: 6,
  defaultMaxWeeklyTeachingPeriods: null,
  defaultMinFreeTeachingPeriods: null,
  defaultMaxDailyTeachingPeriods: null,
  defaultMaxConsecutiveTeachingPeriods: null,
};

function makeTeacher(id: string, name?: string): [string, TeacherRosterRow] {
  return [id, { id, name: name ?? `Teacher ${id}`, subject: "Mathematics" }];
}

function makeSlot(overrides: Partial<TimetableSlotRow> & Pick<TimetableSlotRow, "sectionId" | "period">): TimetableSlotRow {
  return {
    id: `${overrides.sectionId}-${overrides.period}`,
    sectionName: "A",
    className: "Class 6",
    teacherId: null,
    subject: "Mathematics",
    ...overrides,
  };
}

function makeContext(overrides: Partial<TodayOperationsContext> = {}): TodayOperationsContext {
  return {
    schoolId: "school-1",
    dateKey: "2026-03-16",
    timeOfDay: "09:00",
    dbDay: 1,
    dateOnly: new Date(2026, 2, 16),
    timetableWorkingDays: 6,
    periodsPerDay: 6,
    workloadDefaults: SCHOOL_WORKLOAD_DEFAULTS,
    teacherWorkloadOverrides: new Map<string, TeacherWorkloadOverrideFields>(),
    periodSchedule: PERIODS,
    periodState: { status: "IN_PERIOD", currentPeriod: PERIODS[1], nextPeriod: PERIODS[2] },
    teachers: new Map([makeTeacher("t1"), makeTeacher("t2"), makeTeacher("t3")]),
    teacherAttendance: new Map(),
    teachersOnLeave: new Set(),
    teacherEarlyLeave: new Map(),
    todaySlots: [],
    todayArrangements: [],
    sections: [{ id: "sec-1", name: "A", classId: "cls-1", className: "Class 6" }],
    ...overrides,
  };
}

// ── PART 10: lecture coverage classification ──────────────────────────────────
describe("classifyTodayLectures", () => {
  it("a slot with no subject is an empty cell — excluded, not UNCOVERED", () => {
    const ctx = makeContext({ todaySlots: [makeSlot({ sectionId: "sec-1", period: 1, subject: null, teacherId: null })] });
    expect(classifyTodayLectures(ctx)).toEqual([]);
  });

  it("a scheduled slot with a present teacher is NORMAL", () => {
    const ctx = makeContext({ todaySlots: [makeSlot({ sectionId: "sec-1", period: 1, teacherId: "t1" })] });
    const [lecture] = classifyTodayLectures(ctx);
    expect(lecture.status).toBe("NORMAL");
    expect(lecture.effectiveTeacherId).toBe("t1");
  });

  it("an absent teacher's slot with a matching arrangement is SUBSTITUTED", () => {
    const ctx = makeContext({
      todaySlots: [makeSlot({ sectionId: "sec-1", period: 1, teacherId: "t1" })],
      teacherAttendance: new Map([["t1", "ABSENT"]]),
      todayArrangements: [{ id: "a1", sectionId: "sec-1", period: 1, subject: "Mathematics", absentTeacherId: "t1", substituteTeacherId: "t2" }],
    });
    const [lecture] = classifyTodayLectures(ctx);
    expect(lecture.status).toBe("SUBSTITUTED");
    expect(lecture.effectiveTeacherId).toBe("t2");
    expect(lecture.unavailabilityReason).toBe("ABSENT");
  });

  it("an absent teacher's slot with NO arrangement is UNCOVERED", () => {
    const ctx = makeContext({
      todaySlots: [makeSlot({ sectionId: "sec-1", period: 1, teacherId: "t1" })],
      teacherAttendance: new Map([["t1", "ABSENT"]]),
    });
    const [lecture] = classifyTodayLectures(ctx);
    expect(lecture.status).toBe("UNCOVERED");
    expect(lecture.effectiveTeacherId).toBeNull();
  });

  it("a teacher on approved leave (not merely ABSENT) also triggers substitution logic", () => {
    const ctx = makeContext({
      todaySlots: [makeSlot({ sectionId: "sec-1", period: 1, teacherId: "t1" })],
      teachersOnLeave: new Set(["t1"]),
    });
    const [lecture] = classifyTodayLectures(ctx);
    expect(lecture.status).toBe("UNCOVERED");
    expect(lecture.unavailabilityReason).toBe("ON_LEAVE");
  });

  it("a subject-having slot with NO assigned teacher and no arrangement is UNCOVERED (never auto-NORMAL)", () => {
    const ctx = makeContext({ todaySlots: [makeSlot({ sectionId: "sec-1", period: 1, teacherId: null, subject: "Science" })] });
    const [lecture] = classifyTodayLectures(ctx);
    expect(lecture.status).toBe("UNCOVERED");
  });
});

describe("summarizeCoverage", () => {
  it("computes coverage percentage across normal+substituted vs scheduled", () => {
    const ctx = makeContext({
      todaySlots: [
        makeSlot({ sectionId: "sec-1", period: 1, teacherId: "t1" }),
        makeSlot({ sectionId: "sec-1", period: 2, teacherId: "t2" }),
        makeSlot({ sectionId: "sec-1", period: 3, teacherId: null, subject: "Science" }),
        makeSlot({ sectionId: "sec-1", period: 4, teacherId: null, subject: null }),
      ],
    });
    const totals = summarizeCoverage(classifyTodayLectures(ctx));
    expect(totals.scheduled).toBe(3); // period 4 excluded (no subject)
    expect(totals.normal).toBe(2);
    expect(totals.uncovered).toBe(1);
    expect(totals.coveragePercentage).toBeCloseTo(66.7, 1);
  });
});

// ── PART 12: next-period risk thresholds ──────────────────────────────────────
describe("classifyRiskLevel (named thresholds)", () => {
  it("NONE with zero uncovered/substituted", () => expect(classifyRiskLevel(0, 0)).toBe("NONE"));
  it("LOW with substitutions but no uncovered lectures", () => expect(classifyRiskLevel(0, 2)).toBe("LOW"));
  it("MEDIUM at exactly MEDIUM_AT uncovered", () => expect(classifyRiskLevel(NEXT_PERIOD_RISK_THRESHOLDS.MEDIUM_AT, 0)).toBe("MEDIUM"));
  it("HIGH at exactly HIGH_AT uncovered", () => expect(classifyRiskLevel(NEXT_PERIOD_RISK_THRESHOLDS.HIGH_AT, 0)).toBe("HIGH"));
  it("CRITICAL at exactly CRITICAL_AT uncovered", () => expect(classifyRiskLevel(NEXT_PERIOD_RISK_THRESHOLDS.CRITICAL_AT, 0)).toBe("CRITICAL"));
});

describe("computeCurrentPeriodOperations / computeNextPeriodRisk", () => {
  it("returns an empty/no-current-period shape when status has no currentPeriod", async () => {
    const ctx = makeContext({ periodState: { status: "AFTER_SCHOOL", currentPeriod: null, nextPeriod: null } });
    const ops = await computeCurrentPeriodOperations(ctx, classifyTodayLectures(ctx));
    expect(ops.periodNumber).toBeNull();
    expect(ops.runningClasses).toBe(0);
  });

  it("hasNextPeriod=false and NONE risk when there is no next period", async () => {
    const ctx = makeContext({ periodState: { status: "AFTER_SCHOOL", currentPeriod: null, nextPeriod: null } });
    const risk = await computeNextPeriodRisk(ctx, classifyTodayLectures(ctx));
    expect(risk.hasNextPeriod).toBe(false);
    expect(risk.riskLevel).toBe("NONE");
  });
});

// ── PART 5/6: teacher status engine ────────────────────────────────────────────
describe("computeTeacherTodayStatuses — base status precedence", () => {
  it("ON_LEAVE takes precedence even if an Attendance row exists", () => {
    const ctx = makeContext({
      teachersOnLeave: new Set(["t1"]),
      teacherAttendance: new Map([["t1", "PRESENT"]]),
    });
    const [status] = computeTeacherTodayStatuses(ctx).filter((s) => s.teacherId === "t1");
    expect(status.baseStatus).toBe("ON_LEAVE");
    expect(status.operationalStatus).toBe("UNAVAILABLE");
  });

  it("NOT_MARKED when no leave and no attendance row exists", () => {
    const ctx = makeContext();
    const [status] = computeTeacherTodayStatuses(ctx).filter((s) => s.teacherId === "t1");
    expect(status.baseStatus).toBe("NOT_MARKED");
    expect(status.operationalStatus).toBe("NOT_MARKED");
  });

  it("PRESENT + a lecture in the current period -> IN_CLASS with currentAssignment set", () => {
    const ctx = makeContext({
      teacherAttendance: new Map([["t1", "PRESENT"]]),
      todaySlots: [makeSlot({ sectionId: "sec-1", period: 2, teacherId: "t1" })], // periodState.currentPeriod = periodNumber 2
    });
    const [status] = computeTeacherTodayStatuses(ctx).filter((s) => s.teacherId === "t1");
    expect(status.operationalStatus).toBe("IN_CLASS");
    expect(status.currentAssignment?.period).toBe(2);
  });

  it("PRESENT with no current-period lecture -> FREE", () => {
    const ctx = makeContext({ teacherAttendance: new Map([["t1", "PRESENT"]]) });
    const [status] = computeTeacherTodayStatuses(ctx).filter((s) => s.teacherId === "t1");
    expect(status.operationalStatus).toBe("FREE");
  });
});

describe("summarizeTeacherStatuses / filterAndPaginateTeacherStatuses", () => {
  it("summary counts match the underlying statuses", () => {
    const ctx = makeContext({
      teacherAttendance: new Map([["t1", "PRESENT"], ["t2", "ABSENT"]]),
      teachersOnLeave: new Set(["t3"]),
    });
    const statuses = computeTeacherTodayStatuses(ctx);
    const summary = summarizeTeacherStatuses(statuses);
    expect(summary.totalActiveTeachers).toBe(3);
    expect(summary.present).toBe(1);
    expect(summary.absent).toBe(1);
    expect(summary.onLeave).toBe(1);
  });

  it("filters by status and paginates deterministically", () => {
    const ctx = makeContext({ teacherAttendance: new Map([["t1", "PRESENT"], ["t2", "PRESENT"]]) });
    const statuses = computeTeacherTodayStatuses(ctx);
    const { data, total } = filterAndPaginateTeacherStatuses(statuses, { filter: "PRESENT", skip: 0, take: 1 });
    expect(total).toBe(2);
    expect(data).toHaveLength(1);
  });
});

// ── PART 13: teacher workload ──────────────────────────────────────────────────
describe("computeTeacherWorkloadToday", () => {
  it("NO_LECTURE when a teacher has zero effective periods today", () => {
    const ctx = makeContext();
    const rows = computeTeacherWorkloadToday(ctx);
    expect(rows.find((r) => r.teacherId === "t1")?.classification).toBe("NO_LECTURE");
  });

  it("LIGHT_LOAD at or under LIGHT_LOAD_MAX_PERIODS effective periods", () => {
    const ctx = makeContext({
      todaySlots: Array.from({ length: LIGHT_LOAD_MAX_PERIODS }, (_, i) => makeSlot({ sectionId: "sec-1", period: i + 1, teacherId: "t1" })),
    });
    const rows = computeTeacherWorkloadToday(ctx);
    expect(rows.find((r) => r.teacherId === "t1")?.classification).toBe("LIGHT_LOAD");
  });

  it("OVERLOADED when effective periods exceed maxDailyTeachingPeriods", () => {
    const ctx = makeContext({
      periodsPerDay: 8,
      workloadDefaults: { ...SCHOOL_WORKLOAD_DEFAULTS, periodsPerDay: 8, defaultMaxDailyTeachingPeriods: 3 },
      todaySlots: Array.from({ length: 5 }, (_, i) => makeSlot({ sectionId: "sec-1", period: i + 1, teacherId: "t1" })),
    });
    const row = computeTeacherWorkloadToday(ctx).find((r) => r.teacherId === "t1")!;
    expect(row.classification).toBe("OVERLOADED");
    expect(row.warnings).toContain("HIGH_DAILY_LOAD");
  });

  it("a per-teacher TeacherWorkloadOverride is actually applied (not silently ignored)", () => {
    const ctx = makeContext({
      todaySlots: Array.from({ length: 4 }, (_, i) => makeSlot({ sectionId: "sec-1", period: i + 1, teacherId: "t1" })),
      teacherWorkloadOverrides: new Map([["t1", { maxWeeklyTeachingPeriods: null, minFreeTeachingPeriods: null, maxDailyTeachingPeriods: 2, maxConsecutiveTeachingPeriods: null }]]),
    });
    const row = computeTeacherWorkloadToday(ctx).find((r) => r.teacherId === "t1")!;
    expect(row.maxDailyTeachingPeriods).toBe(2);
    expect(row.classification).toBe("OVERLOADED");
  });
});

// ── PART 14: needs attention priority ordering ────────────────────────────────
const CURRENT_PERIOD_BASE = { status: "IN_PERIOD" as const, periodNumber: 2, label: "P2", runningClasses: 0, normal: 0, substituted: 0, uncovered: 0, teachersInClass: 0, teachersFree: 0, teachersUnavailable: 0, uncoveredDetails: [] as UncoveredLectureDetail[] };
const NEXT_PERIOD_BASE = { hasNextPeriod: true, periodNumber: 3, label: "P3", startTime: "09:30", startsInMinutes: 30, scheduled: 0, unavailableTeacherLectures: 0, covered: 0, uncovered: 0, riskLevel: "NONE" as const, uncoveredDetails: [] as UncoveredLectureDetail[] };

function baseAttentionInputs(overrides: Partial<NeedsAttentionInputs> = {}): NeedsAttentionInputs {
  return {
    currentPeriodOps: { ...CURRENT_PERIOD_BASE },
    nextPeriodRisk: { ...NEXT_PERIOD_BASE },
    attendanceCompletion: { expectedSections: 1, submittedSections: 1, partialSections: 0, pendingSections: 0, completionPercentage: 100, sections: [] },
    teacherStatuses: [],
    pendingTeacherLeaveCount: 0,
    pendingEarlyLeaveCount: 0,
    ...overrides,
  };
}

describe("computeNeedsAttention", () => {
  it("produces no items when nothing needs attention", () => {
    expect(computeNeedsAttention(baseAttentionInputs())).toEqual([]);
  });

  it("orders CRITICAL (uncovered now) before HIGH (next period uncovered) before MEDIUM/LOW", () => {
    const items = computeNeedsAttention(
      baseAttentionInputs({
        currentPeriodOps: { ...CURRENT_PERIOD_BASE, uncovered: 1 },
        nextPeriodRisk: { ...NEXT_PERIOD_BASE, uncovered: 2, riskLevel: "HIGH" },
        pendingTeacherLeaveCount: 1,
      })
    );
    expect(items[0].code).toBe("UNCOVERED_LECTURES");
    expect(items[0].severity).toBe("CRITICAL");
    expect(items[1].code).toBe("NEXT_PERIOD_UNCOVERED");
    expect(items[items.length - 1].code).toBe("TEACHER_LEAVE_PENDING");
  });

  it("optional signals (homework/exam/report-card/smart-timetable) are absent -> no items when omitted", () => {
    const items = computeNeedsAttention(baseAttentionInputs());
    expect(items.find((i) => i.code === "HOMEWORK_REVIEW_BACKLOG")).toBeUndefined();
  });

  it("optional signals produce items when present", () => {
    const items = computeNeedsAttention(baseAttentionInputs({ homeworkPendingReviewCount: 3, smartTimetableJobsFailed: 1 }));
    expect(items.map((i) => i.code)).toEqual(expect.arrayContaining(["HOMEWORK_REVIEW_BACKLOG", "SMART_TIMETABLE_JOB_FAILED"]));
  });

  // ── Teacher Operations Head Phase 3 — PART 25 ──────────────────────────────
  it("noActiveOperationsHead omitted/false -> no NO_ACTIVE_OPERATIONS_HEAD item", () => {
    const items = computeNeedsAttention(baseAttentionInputs());
    expect(items.find((i) => i.code === "NO_ACTIVE_OPERATIONS_HEAD")).toBeUndefined();
  });

  it("noActiveOperationsHead=true with no coverage risk -> MEDIUM severity", () => {
    const items = computeNeedsAttention(baseAttentionInputs({ noActiveOperationsHead: true }));
    const item = items.find((i) => i.code === "NO_ACTIVE_OPERATIONS_HEAD");
    expect(item?.severity).toBe("MEDIUM");
    expect(item?.actionTarget).toBe("OPERATIONS_ROLE_CONFIGURATION");
  });

  it("noActiveOperationsHead=true WITH an imminent coverage risk -> escalates to CRITICAL", () => {
    const items = computeNeedsAttention(
      baseAttentionInputs({ noActiveOperationsHead: true, currentPeriodOps: { ...CURRENT_PERIOD_BASE, uncovered: 1 } })
    );
    const item = items.find((i) => i.code === "NO_ACTIVE_OPERATIONS_HEAD");
    expect(item?.severity).toBe("CRITICAL");
  });
});

// ── PART 21: operations health ────────────────────────────────────────────────
describe("computeOperationsHealth", () => {
  it("HEALTHY with no attention items", () => {
    expect(computeOperationsHealth([]).status).toBe("HEALTHY");
  });
  it("CRITICAL whenever any CRITICAL item is present, regardless of others", () => {
    const health = computeOperationsHealth([
      { code: "UNCOVERED_LECTURES", severity: "CRITICAL", title: "", description: "", count: 1, actionTarget: null, metadata: {} },
    ]);
    expect(health.status).toBe("CRITICAL");
  });
  it("NEEDS_ATTENTION when the worst item is HIGH", () => {
    const health = computeOperationsHealth([
      { code: "SMART_TIMETABLE_JOB_FAILED", severity: "HIGH", title: "", description: "", count: 1, actionTarget: null, metadata: {} },
    ]);
    expect(health.status).toBe("NEEDS_ATTENTION");
  });
  it("score is deterministic and monotonically decreases with more/worse items", () => {
    const one = computeOperationsHealth([{ code: "TEACHER_LEAVE_PENDING", severity: "LOW", title: "", description: "", count: 1, actionTarget: null, metadata: {} }]);
    const two = computeOperationsHealth([
      { code: "TEACHER_LEAVE_PENDING", severity: "LOW", title: "", description: "", count: 1, actionTarget: null, metadata: {} },
      { code: "EARLY_LEAVE_PENDING", severity: "MEDIUM", title: "", description: "", count: 1, actionTarget: null, metadata: {} },
    ]);
    expect(two.score).toBeLessThan(one.score);
  });
});
