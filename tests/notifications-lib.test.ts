import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    studentGuardian: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/operational-role-resolver", () => ({
  resolveEffectiveOperationalRole: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { resolveEffectiveOperationalRole } from "@/lib/operational-role-resolver";
import {
  buildNotificationIdempotencyKey,
  createNotificationsBounded,
  enqueueNotificationFanout,
  guardianRecipientsForStudents,
  leadershipRecipientsForSchool,
} from "@/lib/notifications";

const p = prisma as unknown as {
  studentGuardian: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
};

const mockResolveEffectiveOperationalRole = resolveEffectiveOperationalRole as unknown as ReturnType<typeof vi.fn>;

const NO_EFFECTIVE_ROLE = {
  roleType: "TEACHER_OPERATIONS",
  dateKey: "2026-07-17",
  effectiveTeacher: null,
  effectiveAssignmentId: null,
  effectivePriority: null,
  assignmentType: null,
  primaryTeacher: null,
  reasonCode: "NO_ASSIGNMENTS_CONFIGURED",
  chain: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveEffectiveOperationalRole.mockResolvedValue(NO_EFFECTIVE_ROLE);
});

function fakeTx(overrides: Record<string, unknown> = {}) {
  return {
    notification: { create: vi.fn().mockResolvedValue({ id: "n1" }) },
    backgroundJob: { create: vi.fn().mockResolvedValue({ id: "job1" }), findFirst: vi.fn() },
    ...overrides,
  };
}

describe("buildNotificationIdempotencyKey", () => {
  it("is deterministic for identical inputs", () => {
    const args = { eventType: "HOMEWORK_PUBLISHED" as const, entityType: "Homework", entityId: "hw1", recipientType: "STUDENT" as const, recipientId: "s1" };
    expect(buildNotificationIdempotencyKey(args)).toBe(buildNotificationIdempotencyKey(args));
  });

  it("differs when the version key differs (a genuinely new occurrence gets a new key)", () => {
    const base = { eventType: "ANNOUNCEMENT_CORRECTED" as const, entityType: "Announcement", entityId: "a1", recipientType: "STUDENT" as const, recipientId: "s1" };
    const key1 = buildNotificationIdempotencyKey({ ...base, versionKey: "1" });
    const key2 = buildNotificationIdempotencyKey({ ...base, versionKey: "2" });
    expect(key1).not.toBe(key2);
  });
});

describe("createNotificationsBounded — idempotency", () => {
  it("creates one row per recipient using the recipient-specific FK column", async () => {
    const tx = fakeTx();
    await createNotificationsBounded(tx as never, {
      schoolId: "school-a",
      eventType: "STUDENT_LEAVE_APPROVED",
      entityType: "LeaveRequest",
      entityId: "leave-1",
      recipients: [
        { recipientType: "STUDENT", recipientId: "st1" },
        { recipientType: "GUARDIAN", recipientId: "g1" },
      ],
    });
    expect(tx.notification.create).toHaveBeenCalledTimes(2);
    const [studentCall, guardianCall] = tx.notification.create.mock.calls.map((c) => c[0].data);
    expect(studentCall).toMatchObject({ recipientType: "STUDENT", studentId: "st1" });
    expect(guardianCall).toMatchObject({ recipientType: "GUARDIAN", guardianId: "g1" });
  });

  it("treats a duplicate idempotencyKey (P2002) as a safe no-op, not a failure", async () => {
    const tx = fakeTx({ notification: { create: vi.fn().mockRejectedValue({ code: "P2002" }) } });
    const result = await createNotificationsBounded(tx as never, {
      schoolId: "school-a",
      eventType: "STUDENT_LEAVE_APPROVED",
      entityType: "LeaveRequest",
      entityId: "leave-1",
      recipients: [{ recipientType: "STUDENT", recipientId: "st1" }],
    });
    expect(result.created).toBe(0);
  });

  it("re-throws a non-P2002 error", async () => {
    const tx = fakeTx({ notification: { create: vi.fn().mockRejectedValue(new Error("db down")) } });
    await expect(
      createNotificationsBounded(tx as never, {
        schoolId: "school-a",
        eventType: "STUDENT_LEAVE_APPROVED",
        entityType: "LeaveRequest",
        entityId: "leave-1",
        recipients: [{ recipientType: "STUDENT", recipientId: "st1" }],
      })
    ).rejects.toThrow("db down");
  });

  it("rejects an unbounded recipient list rather than silently looping over it", async () => {
    const tx = fakeTx();
    const recipients = Array.from({ length: 201 }, (_, i) => ({ recipientType: "STUDENT" as const, recipientId: `s${i}` }));
    await expect(
      createNotificationsBounded(tx as never, { schoolId: "school-a", eventType: "HOMEWORK_PUBLISHED", entityType: "Homework", entityId: "hw1", recipients })
    ).rejects.toThrow(/bounded-path ceiling/);
  });
});

describe("enqueueNotificationFanout — durable outbox dedup", () => {
  it("creates a NOTIFICATION_FANOUT job with the recipient list in its payload", async () => {
    const tx = fakeTx();
    const result = await enqueueNotificationFanout(tx as never, {
      schoolId: "school-a",
      eventType: "ATTENDANCE_ABSENT",
      entityType: "AttendanceSession",
      entityId: "session-1",
      recipients: [{ recipientType: "STUDENT", recipientId: "st1" }],
    });
    expect(result).toMatchObject({ jobId: "job1" });
    expect(tx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "NOTIFICATION_FANOUT", schoolId: "school-a" }) })
    );
  });

  it("returns skipped:true (no job created) for an empty recipient list", async () => {
    const tx = fakeTx();
    const result = await enqueueNotificationFanout(tx as never, {
      schoolId: "school-a",
      eventType: "ATTENDANCE_ABSENT",
      entityType: "AttendanceSession",
      entityId: "session-1",
      recipients: [],
    });
    expect(result).toEqual({ skipped: true });
    expect(tx.backgroundJob.create).not.toHaveBeenCalled();
  });

  it("on a duplicate-active-job conflict (P2002), returns the existing job instead of throwing", async () => {
    const tx = fakeTx({
      backgroundJob: {
        create: vi.fn().mockRejectedValue({ code: "P2002" }),
        findFirst: vi.fn().mockResolvedValue({ id: "existing-job" }),
      },
    });
    const result = await enqueueNotificationFanout(tx as never, {
      schoolId: "school-a",
      eventType: "ATTENDANCE_ABSENT",
      entityType: "AttendanceSession",
      entityId: "session-1",
      recipients: [{ recipientType: "STUDENT", recipientId: "st1" }],
    });
    expect(result).toEqual({ jobId: "existing-job", deduplicated: true });
  });
});

describe("guardianRecipientsForStudents", () => {
  it("returns a deduplicated GUARDIAN recipient for every distinct linked guardian", async () => {
    p.studentGuardian.findMany.mockResolvedValue([{ guardianId: "g1" }, { guardianId: "g2" }, { guardianId: "g1" }]);
    const result = await guardianRecipientsForStudents(["st1", "st2"]);
    expect(result.map((r) => r.recipientId).sort()).toEqual(["g1", "g2"]);
    expect(result.every((r) => r.recipientType === "GUARDIAN")).toBe(true);
  });

  it("returns an empty array without querying when given no students", async () => {
    const result = await guardianRecipientsForStudents([]);
    expect(result).toEqual([]);
    expect(p.studentGuardian.findMany).not.toHaveBeenCalled();
  });
});

describe("leadershipRecipientsForSchool", () => {
  it("returns every Owner/Admin/VP User of the school as an ADMIN_STAFF recipient", async () => {
    p.user.findMany.mockResolvedValue([{ id: "owner1" }, { id: "admin1" }]);
    const result = await leadershipRecipientsForSchool("school-a");
    expect(result).toEqual([
      { recipientType: "ADMIN_STAFF", recipientId: "owner1" },
      { recipientType: "ADMIN_STAFF", recipientId: "admin1" },
    ]);
    expect(p.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-a", role: { in: ["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"] } } })
    );
  });

  it("also includes the currently-effective TEACHER_OPERATIONS delegate as a TEACHER recipient", async () => {
    p.user.findMany.mockResolvedValue([{ id: "owner1" }]);
    mockResolveEffectiveOperationalRole.mockResolvedValue({
      ...NO_EFFECTIVE_ROLE,
      effectiveTeacher: { id: "delegate-teacher-1", name: "Delegated Teacher" },
      effectiveAssignmentId: "assign-1",
      effectivePriority: 1,
      assignmentType: "ALTERNATE",
      reasonCode: "AVAILABLE",
    });

    const result = await leadershipRecipientsForSchool("school-a");

    expect(result).toEqual([
      { recipientType: "ADMIN_STAFF", recipientId: "owner1" },
      { recipientType: "TEACHER", recipientId: "delegate-teacher-1" },
    ]);
    expect(mockResolveEffectiveOperationalRole).toHaveBeenCalledWith({ schoolId: "school-a", roleType: "TEACHER_OPERATIONS" });
  });

  it("does NOT add a TEACHER recipient when no teacher currently holds the delegation", async () => {
    p.user.findMany.mockResolvedValue([{ id: "owner1" }]);
    mockResolveEffectiveOperationalRole.mockResolvedValue(NO_EFFECTIVE_ROLE);

    const result = await leadershipRecipientsForSchool("school-a");

    expect(result).toEqual([{ recipientType: "ADMIN_STAFF", recipientId: "owner1" }]);
    expect(result.some((r) => r.recipientType === "TEACHER")).toBe(false);
  });
});
