import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    operationalRoleAssignment: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/operations-context", () => ({
  resolveSchoolTodayDateOnly: vi.fn(async () => new Date(2026, 2, 16)), // fixed Monday
}));

import { prisma } from "@/lib/prisma";
import { resolveEffectiveOperationalRole, isOperationsHeadUnavailable } from "@/lib/operational-role-resolver";

const p = prisma as unknown as {
  operationalRoleAssignment: { findMany: ReturnType<typeof vi.fn> };
  leaveRequest: { findMany: ReturnType<typeof vi.fn> };
  attendance: { findMany: ReturnType<typeof vi.fn> };
};

function assignment(overrides: Partial<{ id: string; teacherId: string; priority: number; isEnabled: boolean; effectiveFrom: Date | null; effectiveUntil: Date | null; teacherName: string; isDeleted: boolean }> = {}) {
  const teacherId = overrides.teacherId ?? "t1";
  return {
    id: overrides.id ?? `a-${teacherId}`,
    teacherId,
    priority: overrides.priority ?? 0,
    isEnabled: overrides.isEnabled ?? true,
    effectiveFrom: overrides.effectiveFrom ?? null,
    effectiveUntil: overrides.effectiveUntil ?? null,
    teacher: { id: teacherId, name: overrides.teacherName ?? `Teacher ${teacherId}`, isDeleted: overrides.isDeleted ?? false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  p.leaveRequest.findMany.mockResolvedValue([]);
  p.attendance.findMany.mockResolvedValue([]);
});

describe("resolveEffectiveOperationalRole — basic states", () => {
  it("NO_ASSIGNMENTS_CONFIGURED when the chain is empty", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.reasonCode).toBe("NO_ASSIGNMENTS_CONFIGURED");
    expect(result.effectiveTeacher).toBeNull();
    expect(result.chain).toEqual([]);
  });

  it("Primary available -> Primary is effective with assignmentType PRIMARY", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 }), assignment({ teacherId: "amit", priority: 1 })]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("kavita");
    expect(result.assignmentType).toBe("PRIMARY");
    expect(result.effectivePriority).toBe(0);
    expect(result.reasonCode).toBe("FIRST_AVAILABLE");
    expect(result.chain[1].assignmentState).toBe("STANDBY");
  });

  it("Primary on approved leave -> Alternate 1 effective (delegated)", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 }), assignment({ teacherId: "amit", priority: 1 })]);
    p.leaveRequest.findMany.mockResolvedValue([{ teacherId: "kavita" }]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("amit");
    expect(result.assignmentType).toBe("ALTERNATE");
    expect(result.chain[0].assignmentState).toBe("UNAVAILABLE");
    expect(result.chain[0].reasonCode).toBe("APPROVED_LEAVE");
  });

  it("Primary marked ABSENT -> Alternate 1 effective", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 }), assignment({ teacherId: "amit", priority: 1 })]);
    p.attendance.findMany.mockResolvedValue([{ teacherId: "kavita", status: "ABSENT" }]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("amit");
    expect(result.chain[0].reasonCode).toBe("MARKED_ABSENT");
  });

  it("Primary deleted -> Alternate 1 effective", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0, isDeleted: true }), assignment({ teacherId: "amit", priority: 1 })]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("amit");
    expect(result.chain[0].reasonCode).toBe("TEACHER_DELETED");
  });

  it("Primary NOT_MARKED (no attendance row) stays AVAILABLE with a warning flag, not UNAVAILABLE", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 })]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("kavita");
    expect(result.chain[0].assignmentState).toBe("ACTIVE");
    expect(result.chain[0].attendanceNotMarked).toBe(true);
  });

  it("Primary and Alternate 1 both unavailable -> Alternate 2 effective", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([
      assignment({ teacherId: "kavita", priority: 0 }),
      assignment({ teacherId: "amit", priority: 1 }),
      assignment({ teacherId: "pooja", priority: 2 }),
    ]);
    p.leaveRequest.findMany.mockResolvedValue([{ teacherId: "kavita" }, { teacherId: "amit" }]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("pooja");
    expect(result.effectivePriority).toBe(2);
  });

  it("Everyone unavailable -> NO_AVAILABLE_ASSIGNEE, never falls back to a random teacher", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 }), assignment({ teacherId: "amit", priority: 1 })]);
    p.leaveRequest.findMany.mockResolvedValue([{ teacherId: "kavita" }, { teacherId: "amit" }]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher).toBeNull();
    expect(result.reasonCode).toBe("NO_AVAILABLE_ASSIGNEE");
    expect(result.primaryTeacher?.id).toBe("kavita");
  });

  it("Kavita returns (leave ends) -> Kavita is effective again automatically, no restoration action needed", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 }), assignment({ teacherId: "amit", priority: 1 })]);
    p.leaveRequest.findMany.mockResolvedValue([]); // leave no longer covers today
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("kavita");
    expect(result.assignmentType).toBe("PRIMARY");
  });
});

describe("resolveEffectiveOperationalRole — assignment window / disabled states", () => {
  it("a disabled assignment is skipped (ASSIGNMENT_DISABLED)", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0, isEnabled: false }), assignment({ teacherId: "amit", priority: 1 })]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("amit");
    expect(result.chain[0].reasonCode).toBe("ASSIGNMENT_DISABLED");
  });

  it("a future effectiveFrom is not yet active (ASSIGNMENT_NOT_STARTED)", async () => {
    const future = new Date(2099, 0, 1);
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0, effectiveFrom: future }), assignment({ teacherId: "amit", priority: 1 })]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("amit");
    expect(result.chain[0].reasonCode).toBe("ASSIGNMENT_NOT_STARTED");
  });

  it("an expired effectiveUntil is no longer active (ASSIGNMENT_ENDED)", async () => {
    const past = new Date(2000, 0, 1);
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0, effectiveUntil: past }), assignment({ teacherId: "amit", priority: 1 })]);
    const result = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(result.effectiveTeacher?.id).toBe("amit");
    expect(result.chain[0].reasonCode).toBe("ASSIGNMENT_ENDED");
  });
});

describe("resolveEffectiveOperationalRole — determinism and ordering", () => {
  it("is deterministic: identical inputs produce an identical result", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 }), assignment({ teacherId: "amit", priority: 1 })]);
    const first = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    const second = await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    expect(first).toEqual(second);
  });

  it("orders strictly by priority ascending, never by createdAt or array-insertion order", async () => {
    // Deliberately returned out of priority order by the (mocked) findMany call.
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "pooja", priority: 2 }), assignment({ teacherId: "kavita", priority: 0 }), assignment({ teacherId: "amit", priority: 1 })]);
    await resolveEffectiveOperationalRole({ schoolId: "s1", roleType: "TEACHER_OPERATIONS" });
    // orderBy is passed to the (mocked) prisma call — the resolver itself doesn't
    // re-sort, so this proves the query asked for priority-ascending ordering.
    expect(p.operationalRoleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ priority: "asc" }, { id: "asc" }] })
    );
  });
});

describe("isOperationsHeadUnavailable", () => {
  it("false when no chain is configured at all", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([]);
    expect(await isOperationsHeadUnavailable("s1")).toBe(false);
  });

  it("true when a chain exists but nobody is available", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 })]);
    p.leaveRequest.findMany.mockResolvedValue([{ teacherId: "kavita" }]);
    expect(await isOperationsHeadUnavailable("s1")).toBe(true);
  });

  it("false when a chain exists and someone is available", async () => {
    p.operationalRoleAssignment.findMany.mockResolvedValue([assignment({ teacherId: "kavita", priority: 0 })]);
    expect(await isOperationsHeadUnavailable("s1")).toBe(false);
  });
});
