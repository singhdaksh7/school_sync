import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teacher: { findMany: vi.fn(), findFirst: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    attendance: { upsert: vi.fn() },
    section: { findFirst: vi.fn() },
    arrangement: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { configureOperationalRoleChain } from "@/lib/operational-roles";
import { bulkSetTeacherDailyStatus } from "@/lib/teacher-daily-status";
import { assignArrangement } from "@/lib/arrangements";
import { buildDelegatedAuditMetadata } from "@/lib/operational-audit";
import type { OperationalAuthorizationContext } from "@/lib/operational-authorization";

const p = prisma as unknown as {
  teacher: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  leaveRequest: { findMany: ReturnType<typeof vi.fn> };
  attendance: { upsert: ReturnType<typeof vi.fn> };
  section: { findFirst: ReturnType<typeof vi.fn> };
  arrangement: { upsert: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  p.leaveRequest.findMany.mockResolvedValue([]);
});

// ── PART 3/4: data model validation ───────────────────────────────────────────
describe("configureOperationalRoleChain — validation (PART 4)", () => {
  it("rejects an empty chain", async () => {
    const result = await configureOperationalRoleChain({ schoolId: "s1", roleType: "TEACHER_OPERATIONS", assignments: [], createdById: "u1" });
    expect(result).toMatchObject({ ok: false, code: "EMPTY_CHAIN" });
  });

  it("rejects a duplicate priority", async () => {
    const result = await configureOperationalRoleChain({
      schoolId: "s1", roleType: "TEACHER_OPERATIONS", createdById: "u1",
      assignments: [{ teacherId: "t1", priority: 0 }, { teacherId: "t2", priority: 0 }],
    });
    expect(result).toMatchObject({ ok: false, code: "DUPLICATE_PRIORITY" });
  });

  it("rejects a duplicate teacher", async () => {
    const result = await configureOperationalRoleChain({
      schoolId: "s1", roleType: "TEACHER_OPERATIONS", createdById: "u1",
      assignments: [{ teacherId: "t1", priority: 0 }, { teacherId: "t1", priority: 1 }],
    });
    expect(result).toMatchObject({ ok: false, code: "DUPLICATE_TEACHER" });
  });

  it("rejects a negative priority", async () => {
    const result = await configureOperationalRoleChain({
      schoolId: "s1", roleType: "TEACHER_OPERATIONS", createdById: "u1",
      assignments: [{ teacherId: "t1", priority: -1 }],
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_PRIORITY" });
  });

  it("rejects effectiveUntil before effectiveFrom", async () => {
    const result = await configureOperationalRoleChain({
      schoolId: "s1", roleType: "TEACHER_OPERATIONS", createdById: "u1",
      assignments: [{ teacherId: "t1", priority: 0, effectiveFrom: new Date(2026, 5, 1), effectiveUntil: new Date(2026, 0, 1) }],
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_EFFECTIVE_RANGE" });
  });

  it("rejects the WHOLE update (not a partial save) when one teacher is foreign/deleted — never touches $transaction", async () => {
    p.teacher.findMany.mockResolvedValue([{ id: "t1" }]); // t2 missing -> invalid
    const result = await configureOperationalRoleChain({
      schoolId: "s1", roleType: "TEACHER_OPERATIONS", createdById: "u1",
      assignments: [{ teacherId: "t1", priority: 0 }, { teacherId: "t2", priority: 1 }],
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_TEACHER" });
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it("scopes the teacher-existence check to THIS school (tenant isolation)", async () => {
    p.teacher.findMany.mockResolvedValue([{ id: "t1" }]);
    p.$transaction.mockResolvedValue([]);
    await configureOperationalRoleChain({ schoolId: "school-A", roleType: "TEACHER_OPERATIONS", createdById: "u1", assignments: [{ teacherId: "t1", priority: 0 }] });
    expect(p.teacher.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ schoolId: "school-A", isDeleted: false }) }));
  });

  it("replaces the chain atomically inside one $transaction on a valid update", async () => {
    p.teacher.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    const txDeleteMany = vi.fn();
    const txCreate = vi.fn().mockImplementation(({ data }) => ({ ...data, id: `a-${data.teacherId}`, teacher: { name: `Teacher ${data.teacherId}` }, updatedAt: new Date() }));
    p.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ operationalRoleAssignment: { deleteMany: txDeleteMany, create: txCreate } })
    );

    const result = await configureOperationalRoleChain({
      schoolId: "s1", roleType: "TEACHER_OPERATIONS", createdById: "u1",
      assignments: [{ teacherId: "t1", priority: 0 }, { teacherId: "t2", priority: 1 }],
    });
    expect(result.ok).toBe(true);
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { schoolId: "s1", roleType: "TEACHER_OPERATIONS" } });
    expect(txCreate).toHaveBeenCalledTimes(2);
  });
});

// ── PART 17: self-status mutation protection ──────────────────────────────────
describe("bulkSetTeacherDailyStatus — delegated self-mutation guard (PART 17)", () => {
  const delegated: OperationalAuthorizationContext = {
    allowed: true, source: "TEACHER_OPERATIONS_EFFECTIVE", delegated: true,
    effectiveAssignmentId: "a1", priority: 1, primaryTeacherId: "kavita", reasonCode: "FIRST_AVAILABLE",
  };

  it("rejects an effective head's attempt to change their OWN status, applies others normally", async () => {
    p.teacher.findMany.mockResolvedValue([{ id: "amit" }, { id: "ranjan" }]);
    p.$transaction.mockResolvedValue([]);
    const result = await bulkSetTeacherDailyStatus({
      schoolId: "s1", dateOnly: new Date(2026, 2, 16),
      updates: [{ teacherId: "amit", status: "ABSENT" }, { teacherId: "ranjan", status: "PRESENT" }],
      markedById: "amit-user",
      delegatedAudit: { operationalRole: "TEACHER_OPERATIONS", authorizationSource: "TEACHER_OPERATIONS_EFFECTIVE", actorTeacherId: "amit", delegated: true, effectiveAssignmentId: "a1", effectivePriority: 1, primaryTeacherId: "kavita", resolutionReasonCode: "FIRST_AVAILABLE" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const amitResult = result.results.find((r) => r.teacherId === "amit");
      const ranjanResult = result.results.find((r) => r.teacherId === "ranjan");
      expect(amitResult).toMatchObject({ ok: false, reason: "SELF_TEACHER_STATUS_MUTATION_FORBIDDEN" });
      expect(ranjanResult).toMatchObject({ ok: true });
    }
    void delegated;
  });

  it("Owner/Admin (no delegatedAudit) may still correct any teacher, including one who happens to equal the actor's own linked teacher", async () => {
    p.teacher.findMany.mockResolvedValue([{ id: "amit" }]);
    p.$transaction.mockResolvedValue([]);
    const result = await bulkSetTeacherDailyStatus({
      schoolId: "s1", dateOnly: new Date(2026, 2, 16),
      updates: [{ teacherId: "amit", status: "ABSENT" }],
      markedById: "admin-user",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.results[0]).toMatchObject({ ok: true });
  });
});

// ── PART 18/20: manual arrangement assignment ─────────────────────────────────
describe("assignArrangement", () => {
  it("rejects an unknown section", async () => {
    p.section.findFirst.mockResolvedValue(null);
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    const result = await assignArrangement({ schoolId: "s1", date: new Date(2026, 2, 16), sectionId: "bad-section", period: 1, subject: "Math", absentTeacherId: "t1", substituteTeacherId: null });
    expect(result).toMatchObject({ ok: false, code: "SECTION_NOT_IN_SCHOOL" });
  });

  it("rejects an unknown/foreign substitute teacher", async () => {
    p.section.findFirst.mockResolvedValue({ id: "sec1" });
    p.teacher.findFirst.mockResolvedValueOnce({ id: "t1" }).mockResolvedValueOnce(null);
    const result = await assignArrangement({ schoolId: "s1", date: new Date(2026, 2, 16), sectionId: "sec1", period: 1, subject: "Math", absentTeacherId: "t1", substituteTeacherId: "foreign-teacher" });
    expect(result).toMatchObject({ ok: false, code: "TEACHER_NOT_IN_SCHOOL" });
  });

  it("upserts on the (date, absentTeacherId, period) key for a valid assignment", async () => {
    p.section.findFirst.mockResolvedValue({ id: "sec1" });
    p.teacher.findFirst.mockResolvedValueOnce({ id: "t1" }).mockResolvedValueOnce({ id: "t2" });
    p.arrangement.upsert.mockResolvedValue({ id: "arr1" });
    const result = await assignArrangement({ schoolId: "s1", date: new Date(2026, 2, 16), sectionId: "sec1", period: 3, subject: "Math", absentTeacherId: "t1", substituteTeacherId: "t2" });
    expect(result).toMatchObject({ ok: true, arrangementId: "arr1" });
    expect(p.arrangement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date_absentTeacherId_period: expect.objectContaining({ absentTeacherId: "t1", period: 3 }) } })
    );
  });
});

// ── PART 23: delegated audit metadata shape ───────────────────────────────────
describe("buildDelegatedAuditMetadata", () => {
  it("builds a complete, stable metadata block from an operational context", () => {
    const meta = buildDelegatedAuditMetadata("amit", {
      allowed: true, source: "TEACHER_OPERATIONS_EFFECTIVE", delegated: true,
      effectiveAssignmentId: "a1", priority: 1, primaryTeacherId: "kavita", reasonCode: "FIRST_AVAILABLE",
    });
    expect(meta).toEqual({
      operationalRole: "TEACHER_OPERATIONS",
      authorizationSource: "TEACHER_OPERATIONS_EFFECTIVE",
      actorTeacherId: "amit",
      delegated: true,
      effectiveAssignmentId: "a1",
      effectivePriority: 1,
      primaryTeacherId: "kavita",
      resolutionReasonCode: "FIRST_AVAILABLE",
    });
  });

  it("never includes a session token, bearer token, or password field", () => {
    const meta = buildDelegatedAuditMetadata("amit", {
      allowed: true, source: "TEACHER_OPERATIONS_EFFECTIVE", delegated: false,
      effectiveAssignmentId: "a1", priority: 0, primaryTeacherId: "amit", reasonCode: "AVAILABLE",
    });
    const keys = Object.keys(meta).join(",").toLowerCase();
    expect(keys).not.toMatch(/token|password|secret/);
  });
});
