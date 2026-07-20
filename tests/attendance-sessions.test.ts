import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    student: { findMany: vi.fn(), count: vi.fn() },
    attendance: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    attendanceSession: { findUnique: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { saveAttendanceDraft, submitAttendanceSession, loadAttendanceRosterView } from "@/lib/attendance-sessions";

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: vi.fn(),
    attendanceSession: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "session-1", ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    student: { count: vi.fn().mockResolvedValue(0) },
    attendance: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => ({ id: "att-1", ...create })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    attendanceHistory: { createMany: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()));
});

describe("saveAttendanceDraft", () => {
  it("rejects duplicate studentId in the same payload", async () => {
    const result = await saveAttendanceDraft({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1",
      records: [{ studentId: "st1", status: "PRESENT" }, { studentId: "st1", status: "ABSENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "DUPLICATE_STUDENT" });
  });

  it("rejects an out-of-scope student not enrolled in this section", async () => {
    const tx = makeTx({ student: { count: vi.fn().mockResolvedValue(0) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await saveAttendanceDraft({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1",
      records: [{ studentId: "foreign-student", status: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "OUT_OF_SCOPE" });
  });

  it("saves a draft and writes a DRAFT_MARK history entry when the session is DRAFT", async () => {
    const tx = makeTx({ student: { count: vi.fn().mockResolvedValue(1) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await saveAttendanceDraft({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1", actorRole: "TEACHER",
      records: [{ studentId: "st1", status: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: true, sessionStatus: "DRAFT", recordCount: 1 });
    expect((tx as ReturnType<typeof makeTx>).attendanceHistory.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ source: "DRAFT_MARK", newStatus: "PRESENT", oldStatus: null })] })
    );
  });

  it("rejects every draft write once the session is SUBMITTED — changes nothing", async () => {
    const tx = makeTx({
      attendanceSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", status: "SUBMITTED" }), updateMany: vi.fn() },
      student: { count: vi.fn().mockResolvedValue(1) },
    });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await saveAttendanceDraft({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1",
      records: [{ studentId: "st1", status: "ABSENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "SESSION_LOCKED" });
    expect((tx as ReturnType<typeof makeTx>).attendance.upsert).not.toHaveBeenCalled();
  });
});

describe("submitAttendanceSession", () => {
  it("rejects submission when the eligible roster is incomplete, listing missing students", async () => {
    (prisma.student.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "st1" }, { id: "st2" }]);
    const tx = makeTx({ attendance: { findMany: vi.fn().mockResolvedValue([{ id: "a1", studentId: "st1", status: "PRESENT" }]) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await submitAttendanceSession({ schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1" });
    expect(result).toMatchObject({ ok: false, code: "INCOMPLETE_ROSTER", missingStudentIds: ["st2"] });
  });

  it("submits, locks the session, and writes one SUBMISSION history entry per student", async () => {
    (prisma.student.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "st1" }]);
    const tx = makeTx({ attendance: { findMany: vi.fn().mockResolvedValue([{ id: "a1", studentId: "st1", status: "PRESENT" }]) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await submitAttendanceSession({ schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1", actorRole: "TEACHER" });
    expect(result).toMatchObject({ ok: true, submittedCount: 1 });
    expect((tx as ReturnType<typeof makeTx>).attendanceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "session-1", status: "DRAFT" }, data: expect.objectContaining({ status: "SUBMITTED" }) })
    );
    expect((tx as ReturnType<typeof makeTx>).attendanceHistory.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ source: "SUBMISSION", oldStatus: "PRESENT", newStatus: "PRESENT" })] })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ATTENDANCE_SUBMITTED" }));
  });

  it("rejects re-submission of an already-SUBMITTED session", async () => {
    const tx = makeTx({ attendanceSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", status: "SUBMITTED" }), updateMany: vi.fn() } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await submitAttendanceSession({ schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1" });
    expect(result).toMatchObject({ ok: false, code: "ALREADY_SUBMITTED" });
  });

  it("treats a lost race on the guarded update as ALREADY_SUBMITTED and still records nothing further", async () => {
    (prisma.student.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "st1" }]);
    const tx = makeTx({
      attendance: { findMany: vi.fn().mockResolvedValue([{ id: "a1", studentId: "st1", status: "PRESENT" }]) },
      attendanceSession: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockReturnValue({ id: "session-1", status: "DRAFT" }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await submitAttendanceSession({ schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "u1" });
    expect(result).toMatchObject({ ok: false, code: "ALREADY_SUBMITTED" });
    expect((tx as ReturnType<typeof makeTx>).attendanceHistory.createMany).not.toHaveBeenCalled();
  });
});

describe("loadAttendanceRosterView — ON_LEAVE prefill", () => {
  it("suggests ON_LEAVE only for an unmarked student covered by approved leave — never overwrites an explicit mark", async () => {
    (prisma.attendanceSession.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "DRAFT", submittedAt: null, submittedById: null });
    (prisma.student.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "st1" }, { id: "st2" }]);
    (prisma.attendance.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ studentId: "st1", status: "PRESENT" }]);
    (prisma.leaveRequest.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ studentId: "st1" }, { studentId: "st2" }]);

    const view = await loadAttendanceRosterView("s1", "sec1", new Date("2026-01-05"));
    const st1 = view.roster.find((r) => r.studentId === "st1")!;
    const st2 = view.roster.find((r) => r.studentId === "st2")!;

    expect(st1).toMatchObject({ status: "PRESENT", suggested: false });
    expect(st2).toMatchObject({ status: "ON_LEAVE", suggested: true });
  });
});
