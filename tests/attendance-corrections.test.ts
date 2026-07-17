import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    user: { findMany: vi.fn() },
    studentGuardian: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/operational-role-resolver", () => ({
  resolveEffectiveOperationalRole: vi.fn().mockResolvedValue({
    roleType: "TEACHER_OPERATIONS",
    dateKey: "2026-07-17",
    effectiveTeacher: null,
    effectiveAssignmentId: null,
    effectivePriority: null,
    assignmentType: null,
    primaryTeacher: null,
    reasonCode: "NO_ASSIGNMENTS_CONFIGURED",
    chain: [],
  }),
}));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { createCorrectionRequest, reviewCorrectionRequest } from "@/lib/attendance-corrections";

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: vi.fn(),
    attendanceSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", status: "SUBMITTED" }) },
    student: { count: vi.fn().mockResolvedValue(1) },
    attendance: { findMany: vi.fn().mockResolvedValue([{ id: "att-1", studentId: "st1", status: "ABSENT" }]) },
    attendanceCorrectionItem: { findFirst: vi.fn().mockResolvedValue(null) },
    attendanceCorrectionRequest: {
      create: vi.fn().mockResolvedValue({ id: "corr-1" }),
      findFirst: vi.fn(),
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
  (prisma.user.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.studentGuardian.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("createCorrectionRequest", () => {
  it("rejects when the session is DRAFT (not yet submitted)", async () => {
    const tx = makeTx({ attendanceSession: { findUnique: vi.fn().mockResolvedValue({ id: "session-1", status: "DRAFT" }) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createCorrectionRequest({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), requestedById: "t1", requestedByUserId: "u1",
      reason: "wrong mark", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "SESSION_NOT_SUBMITTED" });
  });

  it("rejects when the session does not exist", async () => {
    const tx = makeTx({ attendanceSession: { findUnique: vi.fn().mockResolvedValue(null) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createCorrectionRequest({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), requestedById: "t1", requestedByUserId: "u1",
      reason: "wrong mark", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "SESSION_NOT_SUBMITTED" });
  });

  it("rejects a duplicate student within one request", async () => {
    const result = await createCorrectionRequest({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), requestedById: "t1", requestedByUserId: "u1",
      reason: "x", items: [{ studentId: "st1", requestedStatus: "PRESENT" }, { studentId: "st1", requestedStatus: "LATE" }],
    });
    expect(result).toMatchObject({ ok: false, code: "DUPLICATE_STUDENT" });
  });

  it("rejects a student not enrolled in this school+section", async () => {
    const tx = makeTx({ student: { count: vi.fn().mockResolvedValue(0) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createCorrectionRequest({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), requestedById: "t1", requestedByUserId: "u1",
      reason: "x", items: [{ studentId: "foreign", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "OUT_OF_SCOPE" });
  });

  it("rejects a no-op correction (requested status equals current status)", async () => {
    const tx = makeTx({ attendance: { findMany: vi.fn().mockResolvedValue([{ id: "att-1", studentId: "st1", status: "PRESENT" }]) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createCorrectionRequest({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), requestedById: "t1", requestedByUserId: "u1",
      reason: "x", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "NO_OP" });
  });

  it("rejects an ambiguous overlapping pending request for the same student/session", async () => {
    const tx = makeTx({ attendanceCorrectionItem: { findFirst: vi.fn().mockResolvedValue({ id: "existing-item" }) } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createCorrectionRequest({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), requestedById: "t1", requestedByUserId: "u1",
      reason: "x", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: false, code: "AMBIGUOUS_PENDING_REQUEST" });
  });

  it("creates the request with a snapshot of the CURRENT status as originalStatus", async () => {
    const create = vi.fn().mockResolvedValue({ id: "corr-1" });
    const tx = makeTx({ attendanceCorrectionRequest: { create } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createCorrectionRequest({
      schoolId: "s1", sectionId: "sec1", date: new Date("2026-01-05"), requestedById: "t1", requestedByUserId: "u1",
      reason: "wrong mark", items: [{ studentId: "st1", requestedStatus: "PRESENT" }],
    });
    expect(result).toMatchObject({ ok: true, correctionRequestId: "corr-1" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { create: [expect.objectContaining({ studentId: "st1", originalStatus: "ABSENT", requestedStatus: "PRESENT" })] },
        }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ATTENDANCE_CORRECTION_REQUESTED" }));
  });
});

const PENDING_REQUEST = {
  id: "corr-1",
  status: "PENDING",
  requestedById: "teacher-1",
  sectionId: "sec1",
  date: new Date("2026-01-05"),
  reason: "wrong mark",
  items: [{ studentId: "st1", originalStatus: "ABSENT", requestedStatus: "PRESENT" }],
};

describe("reviewCorrectionRequest", () => {
  it("forbids a teacher from approving their OWN request", async () => {
    const tx = makeTx({ attendanceCorrectionRequest: { findFirst: vi.fn().mockResolvedValue(PENDING_REQUEST), update: vi.fn() } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await reviewCorrectionRequest({
      correctionRequestId: "corr-1", schoolId: "s1", action: "APPROVE", reviewerUserId: "u1", actingTeacherId: "teacher-1",
    });
    expect(result).toMatchObject({ ok: false, code: "SELF_APPROVAL_FORBIDDEN" });
  });

  it("rejection updates status to REJECTED and changes no attendance rows", async () => {
    const update = vi.fn();
    const tx = makeTx({ attendanceCorrectionRequest: { findFirst: vi.fn().mockResolvedValue(PENDING_REQUEST), update } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await reviewCorrectionRequest({
      correctionRequestId: "corr-1", schoolId: "s1", action: "REJECT", reviewerUserId: "admin-1", actingTeacherId: null,
    });
    expect(result).toMatchObject({ ok: true, status: "REJECTED", alreadyFinal: false });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED" }) }));
    expect((tx as ReturnType<typeof makeTx>).attendance.findMany).not.toHaveBeenCalled();
  });

  it("aborts approval atomically when the current attendance no longer matches the recorded original status", async () => {
    const tx = makeTx({
      attendanceCorrectionRequest: { findFirst: vi.fn().mockResolvedValue(PENDING_REQUEST), update: vi.fn() },
      attendance: { findMany: vi.fn().mockResolvedValue([{ id: "att-1", studentId: "st1", status: "PRESENT" }]) }, // no longer ABSENT
    });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await reviewCorrectionRequest({
      correctionRequestId: "corr-1", schoolId: "s1", action: "APPROVE", reviewerUserId: "admin-1", actingTeacherId: null,
    });
    expect(result).toMatchObject({ ok: false, code: "STATUS_CONFLICT", conflictingStudentIds: ["st1"] });
    expect((tx as ReturnType<typeof makeTx>).attendanceCorrectionRequest.update).not.toHaveBeenCalled();
  });

  it("approves, updates only the requested students, and marks the request APPROVED", async () => {
    const attendanceUpdate = vi.fn();
    const requestUpdate = vi.fn();
    const tx = makeTx({
      attendanceCorrectionRequest: { findFirst: vi.fn().mockResolvedValue(PENDING_REQUEST), update: requestUpdate },
      attendance: { findMany: vi.fn().mockResolvedValue([{ id: "att-1", studentId: "st1", status: "ABSENT" }]), update: attendanceUpdate },
    });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await reviewCorrectionRequest({
      correctionRequestId: "corr-1", schoolId: "s1", action: "APPROVE", reviewerUserId: "admin-1", actingTeacherId: null,
    });
    expect(result).toMatchObject({ ok: true, status: "APPROVED", alreadyFinal: false });
    expect(attendanceUpdate).toHaveBeenCalledWith({ where: { id: "att-1" }, data: { status: "PRESENT" } });
    expect(requestUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ATTENDANCE_CORRECTION_APPROVED" }));
  });

  it("is idempotent — reviewing an already-APPROVED request again returns the final state without reapplying", async () => {
    const attendanceUpdate = vi.fn();
    const tx = makeTx({
      attendanceCorrectionRequest: { findFirst: vi.fn().mockResolvedValue({ ...PENDING_REQUEST, status: "APPROVED" }), update: vi.fn() },
      attendance: { findMany: vi.fn(), update: attendanceUpdate },
    });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await reviewCorrectionRequest({
      correctionRequestId: "corr-1", schoolId: "s1", action: "APPROVE", reviewerUserId: "admin-1", actingTeacherId: null,
    });
    expect(result).toMatchObject({ ok: true, status: "APPROVED", alreadyFinal: true });
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for an unknown correction request id", async () => {
    const tx = makeTx({ attendanceCorrectionRequest: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } });
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await reviewCorrectionRequest({ correctionRequestId: "missing", schoolId: "s1", action: "APPROVE", reviewerUserId: "admin-1" });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
