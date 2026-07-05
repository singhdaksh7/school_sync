import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { teacher: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/operational-role-resolver", () => ({
  resolveEffectiveOperationalRole: vi.fn(),
}));
vi.mock("@/lib/teacher-permissions", () => ({
  getTeacherPermissions: vi.fn(async () => [{ module: "HOMEWORK", action: "VIEW" }]),
  getTeacherScope: vi.fn(async () => ({ classIds: [], sectionIds: [], unrestricted: true })),
}));
vi.mock("@/lib/teacher-authorization", () => ({
  requireSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/school-access", () => ({
  schoolLifecycleGate: vi.fn(async () => null),
}));

import { prisma } from "@/lib/prisma";
import { resolveEffectiveOperationalRole } from "@/lib/operational-role-resolver";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { schoolLifecycleGate } from "@/lib/school-access";
import { canManageTeacherOperations, resolveTeacherEffectivePermissions, requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { TEACHER_OPERATIONS_CAPABILITIES } from "@/lib/operational-capabilities";

const p = prisma as unknown as { teacher: { findFirst: ReturnType<typeof vi.fn> } };
const resolveMock = resolveEffectiveOperationalRole as unknown as ReturnType<typeof vi.fn>;
const requireSchoolAccessMock = requireSchoolAccess as unknown as ReturnType<typeof vi.fn>;
const lifecycleMock = schoolLifecycleGate as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks() only resets call history, not mockResolvedValue overrides
  // set by an earlier test — restore the default (unblocked) lifecycle here.
  lifecycleMock.mockResolvedValue(null);
});

function resolvedEffective(teacherId: string, priority: number) {
  return {
    roleType: "TEACHER_OPERATIONS",
    dateKey: "2026-03-16",
    effectiveTeacher: { id: teacherId, name: "T" },
    effectiveAssignmentId: `a-${teacherId}`,
    effectivePriority: priority,
    assignmentType: priority === 0 ? "PRIMARY" : "ALTERNATE",
    primaryTeacher: { id: "primary", name: "Primary" },
    reasonCode: priority === 0 ? "AVAILABLE" : "FIRST_AVAILABLE",
    chain: [],
  };
}
function resolvedNotEffective() {
  return {
    roleType: "TEACHER_OPERATIONS",
    dateKey: "2026-03-16",
    effectiveTeacher: null,
    effectiveAssignmentId: null,
    effectivePriority: null,
    assignmentType: null,
    primaryTeacher: { id: "primary", name: "Primary" },
    reasonCode: "NO_AVAILABLE_ASSIGNEE",
    chain: [],
  };
}

describe("canManageTeacherOperations", () => {
  it("allowed=true, delegated=false for the effective Primary (priority 0)", async () => {
    resolveMock.mockResolvedValue(resolvedEffective("kavita", 0));
    const result = await canManageTeacherOperations({ schoolId: "s1", teacherId: "kavita", capability: "TEACHER_ATTENDANCE_MANAGE" });
    expect(result).toMatchObject({ allowed: true, delegated: false, priority: 0, source: "TEACHER_OPERATIONS_EFFECTIVE" });
  });

  it("allowed=true, delegated=true for an effective Alternate (priority > 0)", async () => {
    resolveMock.mockResolvedValue(resolvedEffective("amit", 1));
    const result = await canManageTeacherOperations({ schoolId: "s1", teacherId: "amit", capability: "TEACHER_ATTENDANCE_MANAGE" });
    expect(result).toMatchObject({ allowed: true, delegated: true, priority: 1 });
  });

  it("allowed=false with the resolver's reasonCode when the teacher is not the effective assignee", async () => {
    resolveMock.mockResolvedValue(resolvedEffective("amit", 1));
    const result = await canManageTeacherOperations({ schoolId: "s1", teacherId: "pooja", capability: "TEACHER_ATTENDANCE_MANAGE" });
    expect(result.allowed).toBe(false);
    expect(result.source).toBe("NOT_EFFECTIVE");
  });

  it("allowed=false with NO_AVAILABLE_ASSIGNEE reason when nobody is effective", async () => {
    resolveMock.mockResolvedValue(resolvedNotEffective());
    const result = await canManageTeacherOperations({ schoolId: "s1", teacherId: "kavita", capability: "TEACHER_ATTENDANCE_MANAGE" });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("NO_AVAILABLE_ASSIGNEE");
  });
});

describe("resolveTeacherEffectivePermissions", () => {
  it("operationalCapabilities is empty and operational is null when not effective", async () => {
    resolveMock.mockResolvedValue(resolvedNotEffective());
    const result = await resolveTeacherEffectivePermissions({ schoolId: "s1", teacherId: "amit" });
    expect(result.operationalCapabilities).toEqual([]);
    expect(result.operational).toBeNull();
    expect(result.customRolePermissions).toEqual([{ module: "HOMEWORK", action: "VIEW" }]);
  });

  it("grants the FULL capability bundle when effective — never a partial subset", async () => {
    resolveMock.mockResolvedValue(resolvedEffective("amit", 1));
    const result = await resolveTeacherEffectivePermissions({ schoolId: "s1", teacherId: "amit" });
    expect(result.operationalCapabilities).toEqual([...TEACHER_OPERATIONS_CAPABILITIES]);
    expect(result.operational?.delegated).toBe(true);
  });
});

describe("requireSchoolAccessOrOperationalCapability", () => {
  it("Admin path (base.ok) never reaches the operational resolver at all", async () => {
    requireSchoolAccessMock.mockResolvedValue({ ok: true, teacherId: null });
    const result = await requireSchoolAccessOrOperationalCapability("s1", "u1", "SCHOOL_ADMIN", "LEAVE", "APPROVE", "TEACHER_LEAVE_APPROVE");
    expect(result.ok).toBe(true);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("a non-TEACHER role denial never falls through to the operational path", async () => {
    requireSchoolAccessMock.mockResolvedValue({ ok: false, response: "DENIED" });
    const result = await requireSchoolAccessOrOperationalCapability("s1", "u1", "VICE_PRINCIPAL", "LEAVE", "APPROVE", "TEACHER_LEAVE_APPROVE");
    expect(result.ok).toBe(false);
    expect(p.teacher.findFirst).not.toHaveBeenCalled();
  });

  it("PART 28 regression guard: a SUSPENDED/EXPIRED school blocks the teacher-delegation fallback even though the base denial was for a different reason", async () => {
    requireSchoolAccessMock.mockResolvedValue({ ok: false, response: "DENIED" });
    lifecycleMock.mockResolvedValue("BLOCKED_RESPONSE");
    const result = await requireSchoolAccessOrOperationalCapability("s1", "u1", "TEACHER", "LEAVE", "APPROVE", "TEACHER_LEAVE_APPROVE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response).toBe("BLOCKED_RESPONSE");
    // The operational path must never even query for the teacher once lifecycle blocks.
    expect(p.teacher.findFirst).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("a TEACHER with no linked/active teacher record in this school is denied", async () => {
    requireSchoolAccessMock.mockResolvedValue({ ok: false, response: "DENIED" });
    p.teacher.findFirst.mockResolvedValue(null);
    const result = await requireSchoolAccessOrOperationalCapability("s1", "u1", "TEACHER", "LEAVE", "APPROVE", "TEACHER_LEAVE_APPROVE");
    expect(result.ok).toBe(false);
  });

  it("falls back to the effective Operations Head and succeeds when the resolver grants it", async () => {
    requireSchoolAccessMock.mockResolvedValue({ ok: false, response: "DENIED" });
    p.teacher.findFirst.mockResolvedValue({ id: "amit", schoolId: "s1" });
    resolveMock.mockResolvedValue(resolvedEffective("amit", 1));
    const result = await requireSchoolAccessOrOperationalCapability("s1", "u1", "TEACHER", "LEAVE", "APPROVE", "TEACHER_LEAVE_APPROVE");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.teacherId).toBe("amit");
      expect(result.operational?.delegated).toBe(true);
    }
  });

  it("denies (base.response) when the teacher exists but is not the effective assignee", async () => {
    requireSchoolAccessMock.mockResolvedValue({ ok: false, response: "DENIED" });
    p.teacher.findFirst.mockResolvedValue({ id: "pooja", schoolId: "s1" });
    resolveMock.mockResolvedValue(resolvedEffective("amit", 1));
    const result = await requireSchoolAccessOrOperationalCapability("s1", "u1", "TEACHER", "LEAVE", "APPROVE", "TEACHER_LEAVE_APPROVE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response).toBe("DENIED");
  });
});
