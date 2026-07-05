import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { count: vi.fn(), groupBy: vi.fn() },
    attendance: { groupBy: vi.fn() },
    section: { findMany: vi.fn() },
    feePayment: { aggregate: vi.fn(), findMany: vi.fn() },
    feeStructure: { findMany: vi.fn() },
    examScheme: { findFirst: vi.fn() },
    examResult: { groupBy: vi.fn() },
    reportCard: { groupBy: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { computeStudentAttendanceSummary, computeAttendanceCompletion } from "@/lib/operations-attendance";
import { computeFeeTodaySummary } from "@/lib/operations-fees";
import { computeReportCardProgress } from "@/lib/operations-report-cards";
import { computeExamSchemeProgress } from "@/lib/operations-exams";

const p = prisma as unknown as {
  student: { count: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
  attendance: { groupBy: ReturnType<typeof vi.fn> };
  section: { findMany: ReturnType<typeof vi.fn> };
  feePayment: { aggregate: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  feeStructure: { findMany: ReturnType<typeof vi.fn> };
  examScheme: { findFirst: ReturnType<typeof vi.fn> };
  examResult: { groupBy: ReturnType<typeof vi.fn> };
  reportCard: { groupBy: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

// ── PART 8: student attendance summary ────────────────────────────────────────
describe("computeStudentAttendanceSummary", () => {
  it("counts LATE as present, computes a rounded percentage", async () => {
    p.student.count.mockResolvedValue(10);
    p.attendance.groupBy.mockResolvedValue([
      { status: "PRESENT", _count: { _all: 6 } },
      { status: "LATE", _count: { _all: 1 } },
      { status: "ABSENT", _count: { _all: 2 } },
    ]);
    const summary = await computeStudentAttendanceSummary("s1", new Date());
    expect(summary).toMatchObject({ total: 10, present: 7, absent: 2, attendancePercentage: 70 });
  });

  it("returns null percentage for a school with zero students", async () => {
    p.student.count.mockResolvedValue(0);
    p.attendance.groupBy.mockResolvedValue([]);
    const summary = await computeStudentAttendanceSummary("s1", new Date());
    expect(summary.attendancePercentage).toBeNull();
  });
});

// ── PART 9: attendance completion engine ──────────────────────────────────────
describe("computeAttendanceCompletion", () => {
  it("derives SUBMITTED/PARTIAL/PENDING from expected-vs-recorded groupBy counts, excluding zero-student sections", async () => {
    p.section.findMany.mockResolvedValue([
      { id: "sec-full", name: "A", class: { name: "6" }, mentor: { id: "t1", name: "Teacher One" } },
      { id: "sec-partial", name: "B", class: { name: "6" }, mentor: null },
      { id: "sec-empty", name: "C", class: { name: "6" }, mentor: null },
    ]);
    p.student.groupBy.mockResolvedValue([
      { sectionId: "sec-full", _count: { _all: 10 } },
      { sectionId: "sec-partial", _count: { _all: 10 } },
      // sec-empty has zero students -> no row here
    ]);
    p.attendance.groupBy.mockResolvedValue([
      { sectionId: "sec-full", status: "PRESENT", _count: { _all: 10 } },
      { sectionId: "sec-partial", status: "PRESENT", _count: { _all: 4 } },
    ]);

    const result = await computeAttendanceCompletion("s1", new Date());
    expect(result.expectedSections).toBe(2); // sec-empty excluded
    expect(result.submittedSections).toBe(1);
    expect(result.partialSections).toBe(1);
    expect(result.pendingSections).toBe(0);

    const full = result.sections.find((s) => s.sectionId === "sec-full")!;
    expect(full.completion).toBe("SUBMITTED");
    expect(full.responsibleTeacherName).toBe("Teacher One");
    expect(full.responsibilityUnresolved).toBe(false);

    const partial = result.sections.find((s) => s.sectionId === "sec-partial")!;
    expect(partial.completion).toBe("PARTIAL");
    expect(partial.missingCount).toBe(6);
    expect(partial.responsibilityUnresolved).toBe(true);
  });

  it("a section with zero recorded rows is PENDING, not PARTIAL", async () => {
    p.section.findMany.mockResolvedValue([{ id: "sec-1", name: "A", class: { name: "6" }, mentor: null }]);
    p.student.groupBy.mockResolvedValue([{ sectionId: "sec-1", _count: { _all: 5 } }]);
    p.attendance.groupBy.mockResolvedValue([]);

    const result = await computeAttendanceCompletion("s1", new Date());
    expect(result.sections[0].completion).toBe("PENDING");
    expect(result.sections[0].presentRate).toBeNull();
  });
});

// ── PART 16: exam progress (no inferred current exam) ─────────────────────────
describe("computeExamSchemeProgress", () => {
  it("returns null when the examSchemeId does not belong to this school", async () => {
    p.examScheme.findFirst.mockResolvedValue(null);
    const result = await computeExamSchemeProgress("s1", "scheme-x");
    expect(result).toBeNull();
    expect(p.examScheme.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "scheme-x", schoolId: "s1" } }));
  });

  it("computes pendingCount as totalStudents minus submitted results per exam", async () => {
    p.examScheme.findFirst.mockResolvedValue({ id: "scheme-1", exams: [{ id: "exam-1", name: "Midterm", maxMarks: 100 }] });
    p.student.count.mockResolvedValue(20);
    p.examResult.groupBy.mockResolvedValue([{ examId: "exam-1", _count: { _all: 15 } }]);

    const result = await computeExamSchemeProgress("s1", "scheme-1");
    expect(result!.exams[0]).toMatchObject({ totalStudents: 20, resultsSubmitted: 15, pendingCount: 5 });
    expect(result!.totalPendingResults).toBe(5);
  });
});

// ── PART 17: report card progress ──────────────────────────────────────────────
describe("computeReportCardProgress", () => {
  it("returns null for an unknown examSchemeId", async () => {
    p.examScheme.findFirst.mockResolvedValue(null);
    expect(await computeReportCardProgress("s1", "scheme-x")).toBeNull();
  });

  it("computes expected/generated/published/pendingCount per section, excluding zero-student sections", async () => {
    p.examScheme.findFirst.mockResolvedValue({ id: "scheme-1" });
    p.section.findMany.mockResolvedValue([
      { id: "sec-1", name: "A", class: { name: "6" } },
      { id: "sec-empty", name: "B", class: { name: "6" } },
    ]);
    p.student.groupBy.mockResolvedValue([{ sectionId: "sec-1", _count: { _all: 10 } }]);
    p.reportCard.groupBy.mockResolvedValue([
      { sectionId: "sec-1", status: "PUBLISHED", _count: { _all: 6 } },
      { sectionId: "sec-1", status: "DRAFT", _count: { _all: 2 } },
    ]);

    const result = await computeReportCardProgress("s1", "scheme-1");
    expect(result!.sections).toHaveLength(1); // sec-empty excluded
    const row = result!.sections[0];
    expect(row).toMatchObject({ expected: 10, generated: 8, published: 6, pendingCount: 2 });
  });
});

// ── PART 18: fee today insights (Decimal-safe, aggregate not per-student loop) ─
describe("computeFeeTodaySummary", () => {
  it("computes totalExpectedAmount via FeeStructure x student-count aggregates (class-scoped and school-wide)", async () => {
    p.feePayment.aggregate
      .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { amount: { toString: () => "1000.00" } } }) // today
      .mockResolvedValueOnce({ _sum: { amount: { toString: () => "3000.00" } } }) // month-to-date
      .mockResolvedValueOnce({ _sum: { amount: { toString: () => "50000.00" } } }); // all-time
    p.feeStructure.findMany.mockResolvedValue([
      { amount: { toString: () => "500.00" }, classId: "cls-1" }, // class-scoped
      { amount: { toString: () => "100.00" }, classId: null }, // school-wide
    ]);
    p.section.findMany.mockResolvedValue([{ id: "sec-1", classId: "cls-1" }]);
    p.student.groupBy.mockResolvedValue([{ sectionId: "sec-1", _count: { _all: 20 } }]);

    const summary = await computeFeeTodaySummary("s1", new Date());
    // cls-1: 500 * 20 = 10000; school-wide: 100 * 20 (total students) = 2000 -> 12000 total expected
    expect(summary.totalExpectedAmount).toBe(12000);
    expect(summary.totalPaidAllTime).toBe(50000);
    expect(summary.outstandingAmount).toBe(0); // paid exceeds expected -> floored at 0
    expect(summary.paymentsRecordedToday).toBe(2);
    expect(summary.amountRecordedToday).toBe(1000);
    expect(summary.monthToDateAmount).toBe(3000);
  });

  it("floors outstandingAmount at 0 rather than going negative, and handles a school with no fee structures", async () => {
    p.feePayment.aggregate
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } });
    p.feeStructure.findMany.mockResolvedValue([]);
    p.section.findMany.mockResolvedValue([]);
    p.student.groupBy.mockResolvedValue([]);

    const summary = await computeFeeTodaySummary("s1", new Date());
    expect(summary.totalExpectedAmount).toBe(0);
    expect(summary.outstandingAmount).toBe(0);
  });
});
