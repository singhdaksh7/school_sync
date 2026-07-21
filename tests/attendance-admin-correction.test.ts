import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    leaveRequest: { findMany: vi.fn() },
    attendanceSession: { findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
    studentGuardian: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { applyAdminAttendanceCorrection, listAttendanceReconciliationItems } from "@/lib/attendance-admin-correction";

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: vi.fn(),
    attendanceSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", status: "SUBMITTED" }) },
    student: { count: vi.fn().mockResolvedValue(1) },
    attendance: {
      findUnique: vi.fn().mockResolvedValue({ id: "att-1", status: "ABSENT" }),
      update: vi.fn(),
    },
    attendanceHistory: { createMany: vi.fn() },
    notification: { create: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()));
  (prisma.studentGuardian.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("applyAdminAttendanceCorrection", () => {
  it("requires the session to be SUBMITTED — a teacher gains no emergency-correction ability merely by having drafted attendance", async () => {
    const tx = makeTx({ attendanceSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", status: "DRAFT" }) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await applyAdminAttendanceCorrection({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "admin-1",
      reason: "audit fix", source: "ADMIN_EMERGENCY", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "SESSION_NOT_SUBMITTED" });
  });

  it("rejects a cross-section/unknown student", async () => {
    const tx = makeTx({ student: { count: vi.fn().mockResolvedValue(0) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await applyAdminAttendanceCorrection({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "admin-1",
      reason: "audit fix", source: "ADMIN_EMERGENCY", items: [{ studentId: "foreign", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "OUT_OF_SCOPE" });
  });

  it("updates only the listed students, in one transaction, with before/after history and an audit action", async () => {
    const update = vi.fn();
    const tx = makeTx({ attendance: { findUnique: vi.fn().mockResolvedValue({ id: "att-1", status: "ABSENT" }), update } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await applyAdminAttendanceCorrection({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "admin-1", actorRole: "SCHOOL_ADMIN",
      reason: "audit fix", source: "ADMIN_EMERGENCY", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: true, updatedCount: 1 });
    expect(update).toHaveBeenCalledWith({ where: { id: "att-1" }, data: { status: "PRESENT" } });
    expect((tx as ReturnType<typeof makeTx>).attendanceHistory.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ oldStatus: "ABSENT", newStatus: "PRESENT", source: "ADMIN_EMERGENCY", reason: "audit fix" })] })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ATTENDANCE_ADMIN_CORRECTED" }));
  });

  it("notifies the affected student + guardian only when the final status actually changed", async () => {
    const tx = makeTx({ attendance: { findUnique: vi.fn().mockResolvedValue({ id: "att-1", status: "ABSENT" }), update: vi.fn() } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
    (prisma.studentGuardian.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ guardianId: "g1" }]);

    await applyAdminAttendanceCorrection({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "admin-1",
      reason: "audit fix", source: "ADMIN_EMERGENCY", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect((tx as ReturnType<typeof makeTx>).notification.create).toHaveBeenCalledTimes(2);
  });

  it("does NOT notify when the requested status equals the current status (a no-op correction)", async () => {
    const tx = makeTx({ attendance: { findUnique: vi.fn().mockResolvedValue({ id: "att-1", status: "PRESENT" }), update: vi.fn() } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    await applyAdminAttendanceCorrection({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "admin-1",
      reason: "no real change", source: "ADMIN_EMERGENCY", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect((tx as ReturnType<typeof makeTx>).notification.create).not.toHaveBeenCalled();
  });

  it("never touches the session's own status — it stays SUBMITTED (session is never reopened)", async () => {
    const sessionUpdate = vi.fn();
    const tx = makeTx({ attendanceSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", status: "SUBMITTED" }), update: sessionUpdate } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    await applyAdminAttendanceCorrection({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), actorUserId: "admin-1",
      reason: "audit fix", source: "ADMIN_EMERGENCY", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(sessionUpdate).not.toHaveBeenCalled();
  });
});

describe("listAttendanceReconciliationItems", () => {
  it("surfaces a mismatch instead of silently rewriting locked attendance", async () => {
    (prisma.leaveRequest.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "leave-1", studentId: "st1", fromDate: new Date("2026-01-05"), toDate: new Date("2026-01-06"), student: { sectionId: "sec1" } },
    ]);
    (prisma.attendanceSession.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ date: new Date("2026-01-05") }]);
    (prisma.attendance.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { studentId: "st1", date: new Date("2026-01-05"), status: "ABSENT" },
    ]);

    const items = await listAttendanceReconciliationItems("s1");
    expect(items).toEqual([
      { leaveRequestId: "leave-1", studentId: "st1", sectionId: "sec1", date: "2026-01-05", currentStatus: "ABSENT" },
    ]);
  });

  it("returns nothing when submitted attendance already reflects ON_LEAVE", async () => {
    (prisma.leaveRequest.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "leave-1", studentId: "st1", fromDate: new Date("2026-01-05"), toDate: new Date("2026-01-06"), student: { sectionId: "sec1" } },
    ]);
    (prisma.attendanceSession.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ date: new Date("2026-01-05") }]);
    (prisma.attendance.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const items = await listAttendanceReconciliationItems("s1");
    expect(items).toEqual([]);
  });
});
