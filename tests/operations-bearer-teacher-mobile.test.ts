import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Phase 6 mobile bearer-compatibility closure: guardOperationsCapability and
// the Leave view/approve/reject routes now resolve identity via
// resolveOperationsActor (NextAuth session OR bearer Teacher JWT) instead of
// auth() alone. This proves the NEW bearer path end-to-end without touching
// canAccessSchool/canWriteSchool/canManageTeacherOperations/requireSchoolAccess
// themselves — those are mocked here exactly as the existing suite already
// mocks them elsewhere.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/mobile-auth", () => ({ getMobileAuth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  sessionRole: vi.fn((user: { role?: string }) => user?.role),
  canAccessSchool: vi.fn(),
  canWriteSchool: vi.fn(),
  studentBelongsToSchool: vi.fn(),
  teacherBelongsToSchool: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    teacher: { findFirst: vi.fn() },
    leaveRequest: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/school-access", () => ({ schoolLifecycleGate: vi.fn(async () => null) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/operational-authorization", () => ({
  canManageTeacherOperations: vi.fn(),
  requireSchoolAccessOrOperationalCapability: vi.fn(),
}));
vi.mock("@/lib/operational-audit", () => ({ buildDelegatedAuditMetadata: vi.fn(() => ({ delegated: true })) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/arrangements", () => ({ createArrangementsForLeave: vi.fn(async () => undefined) }));
vi.mock("@/lib/teacher-authorization", () => ({ requireSchoolAccess: vi.fn() }));
vi.mock("@/lib/operations-today-summary", () => ({ computeTodayAtSchoolSummary: vi.fn(async () => ({ ok: true })) }));

import { auth } from "@/lib/auth";
import { getMobileAuth } from "@/lib/mobile-auth";
import { canAccessSchool, canWriteSchool } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { schoolLifecycleGate } from "@/lib/school-access";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { canManageTeacherOperations, requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { GET as todayGET } from "@/app/api/schools/[schoolId]/operations/today/route";
import { PATCH as leavePATCH } from "@/app/api/schools/[schoolId]/leaves/[leaveId]/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getMobileAuthMock = getMobileAuth as unknown as ReturnType<typeof vi.fn>;
const canAccessSchoolMock = canAccessSchool as unknown as ReturnType<typeof vi.fn>;
const canWriteSchoolMock = canWriteSchool as unknown as ReturnType<typeof vi.fn>;
const canManageTeacherOperationsMock = canManageTeacherOperations as unknown as ReturnType<typeof vi.fn>;
const requireSchoolAccessOrOperationalCapabilityMock = requireSchoolAccessOrOperationalCapability as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as {
  teacher: { findFirst: ReturnType<typeof vi.fn> };
  leaveRequest: { findFirst: ReturnType<typeof vi.fn> };
};
const schoolLifecycleGateMock = schoolLifecycleGate as unknown as ReturnType<typeof vi.fn>;
const rateLimitMock = enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;

function bearerReq(url = "http://localhost/x") {
  return new Request(url, { headers: { Authorization: "Bearer mobile-teacher-token" } });
}
function webReq(url = "http://localhost/x") {
  return new Request(url);
}

const BEARER_TEACHER_MOBILE = {
  decoded: { role: "TEACHER", userId: "user-teacher-1", teacherId: "teacher-1", schoolId: "school-a" },
  teacher: { id: "teacher-1", schoolId: "school-a" },
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  getMobileAuthMock.mockResolvedValue(null);
  canAccessSchoolMock.mockResolvedValue(false);
  canWriteSchoolMock.mockResolvedValue(false);
  schoolLifecycleGateMock.mockResolvedValue(null);
  rateLimitMock.mockResolvedValue(null);
});

describe("resolveOperationsActor", () => {
  it("resolves a bearer Teacher token without needing a NextAuth session", async () => {
    getMobileAuthMock.mockResolvedValue(BEARER_TEACHER_MOBILE);
    const actor = await resolveOperationsActor(bearerReq());
    expect(actor).toEqual({ userId: "user-teacher-1", role: "TEACHER" });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("falls back to the NextAuth session when there is no bearer Teacher token", async () => {
    getMobileAuthMock.mockResolvedValue(null);
    authMock.mockResolvedValue({ user: { id: "user-admin-1", role: "ADMIN" } });
    const actor = await resolveOperationsActor(webReq());
    expect(actor).toEqual({ userId: "user-admin-1", role: "ADMIN" });
  });

  it("ignores a non-Teacher bearer decode (e.g. STUDENT/PARENT) and falls back to auth()", async () => {
    getMobileAuthMock.mockResolvedValue({ decoded: { role: "STUDENT", userId: "student-1", schoolId: "school-a" } });
    authMock.mockResolvedValue(null);
    const actor = await resolveOperationsActor(bearerReq());
    expect(actor).toBeNull();
  });

  it("returns null when neither bearer nor session resolves", async () => {
    const actor = await resolveOperationsActor(webReq());
    expect(actor).toBeNull();
  });
});

describe("guardOperationsCapability — bearer Teacher effective Operations Head (Today route)", () => {
  it("denies a normal Teacher (not the effective Operations Head) via bearer", async () => {
    getMobileAuthMock.mockResolvedValue(BEARER_TEACHER_MOBILE);
    p.teacher.findFirst.mockResolvedValue({ id: "teacher-1", schoolId: "school-a" });
    canManageTeacherOperationsMock.mockResolvedValue({ allowed: false, reasonCode: "NOT_EFFECTIVE" });
    const res = await todayGET(bearerReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(403);
  });

  it("accepts a bearer Teacher who IS the effective Operations Head", async () => {
    getMobileAuthMock.mockResolvedValue(BEARER_TEACHER_MOBILE);
    p.teacher.findFirst.mockResolvedValue({ id: "teacher-1", schoolId: "school-a" });
    canManageTeacherOperationsMock.mockResolvedValue({ allowed: true, source: "TEACHER_OPERATIONS_EFFECTIVE", reasonCode: "AVAILABLE" });
    const res = await todayGET(bearerReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(200);
    expect(rateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ actorType: "TEACHER", actorId: "teacher-1" }), "STANDARD_READ");
  });

  it("re-denies once authority is lost mid-session (fresh resolution every call, never cached)", async () => {
    getMobileAuthMock.mockResolvedValue(BEARER_TEACHER_MOBILE);
    p.teacher.findFirst.mockResolvedValue({ id: "teacher-1", schoolId: "school-a" });
    canManageTeacherOperationsMock.mockResolvedValueOnce({ allowed: true, reasonCode: "AVAILABLE" });
    canManageTeacherOperationsMock.mockResolvedValueOnce({ allowed: false, reasonCode: "ASSIGNMENT_ENDED" });

    const first = await todayGET(bearerReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(first.status).toBe(200);
    const second = await todayGET(bearerReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(second.status).toBe(403);
  });

  it("soft-deleted teacher row never resolves via the bearer delegation fallback", async () => {
    getMobileAuthMock.mockResolvedValue(BEARER_TEACHER_MOBILE);
    p.teacher.findFirst.mockResolvedValue(null); // isDeleted:false filter excludes it
    const res = await todayGET(bearerReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(403);
    expect(canManageTeacherOperationsMock).not.toHaveBeenCalled();
  });

  it("a suspended/expired school blocks the bearer delegation fallback too", async () => {
    getMobileAuthMock.mockResolvedValue(BEARER_TEACHER_MOBILE);
    schoolLifecycleGateMock.mockResolvedValue(NextResponse.json({ error: "School suspended" }, { status: 403 }));
    const res = await todayGET(bearerReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(403);
    expect(p.teacher.findFirst).not.toHaveBeenCalled();
  });

  it("cross-tenant: a bearer Teacher from a different school is denied", async () => {
    getMobileAuthMock.mockResolvedValue({
      decoded: { role: "TEACHER", userId: "user-teacher-2", teacherId: "teacher-2", schoolId: "school-b" },
      teacher: { id: "teacher-2", schoolId: "school-b" },
    });
    p.teacher.findFirst.mockResolvedValue({ id: "teacher-2", schoolId: "school-b" });
    const res = await todayGET(bearerReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(403);
  });

  it("unauthenticated (no bearer, no session) is 401", async () => {
    const res = await todayGET(webReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(401);
  });

  it("Owner/Admin/VP web session path is completely unaffected by the bearer addition", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    canAccessSchoolMock.mockResolvedValue(true);
    const res = await todayGET(webReq(), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(200);
    expect(canManageTeacherOperationsMock).not.toHaveBeenCalled();
  });

  it("guardOperationsCapability never lets an ADMIN/OWNER role fall through to the teacher-delegation branch", async () => {
    getMobileAuthMock.mockResolvedValue(null);
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    canAccessSchoolMock.mockResolvedValue(false); // admin path itself denies (e.g. wrong school)
    const result = await guardOperationsCapability(webReq(), "school-a", "STANDARD_READ", "OPERATIONS_TODAY_VIEW", false);
    expect(result.ok).toBe(false);
    expect(p.teacher.findFirst).not.toHaveBeenCalled();
  });
});

describe("Leave PATCH — bearer Teacher effective Operations Head approve/reject", () => {
  function leaveReq(body: unknown) {
    return new Request("http://localhost/api/schools/school-a/leaves/leave-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer mobile-teacher-token" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    getMobileAuthMock.mockResolvedValue(BEARER_TEACHER_MOBILE);
  });

  it("a bearer effective-head Teacher can approve another teacher's leave", async () => {
    requireSchoolAccessOrOperationalCapabilityMock.mockResolvedValue({
      ok: true,
      teacherId: "teacher-1",
      operational: { allowed: true, source: "TEACHER_OPERATIONS_EFFECTIVE", reasonCode: "AVAILABLE" },
    });
    p.leaveRequest.findFirst.mockResolvedValue({ id: "leave-1", schoolId: "school-a", type: "TEACHER", teacherId: "someone-else", fromDate: new Date(), toDate: new Date() });

    const res = await leavePATCH(leaveReq({ status: "APPROVED" }), { params: Promise.resolve({ schoolId: "school-a", leaveId: "leave-1" }) });
    expect(res.status).toBe(200);
    expect(requireSchoolAccessOrOperationalCapabilityMock).toHaveBeenCalledWith("school-a", "user-teacher-1", "TEACHER", "LEAVE", "APPROVE", "TEACHER_LEAVE_APPROVE");
  });

  it("SELF_LEAVE_APPROVAL_FORBIDDEN is preserved on the bearer path — cannot approve own leave", async () => {
    requireSchoolAccessOrOperationalCapabilityMock.mockResolvedValue({
      ok: true,
      teacherId: "teacher-1",
      operational: { allowed: true, source: "TEACHER_OPERATIONS_EFFECTIVE", reasonCode: "AVAILABLE" },
    });
    p.leaveRequest.findFirst.mockResolvedValue({ id: "leave-1", schoolId: "school-a", type: "TEACHER", teacherId: "teacher-1", fromDate: new Date(), toDate: new Date() });

    const res = await leavePATCH(leaveReq({ status: "APPROVED" }), { params: Promise.resolve({ schoolId: "school-a", leaveId: "leave-1" }) });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.reasonCode).toBe("SELF_LEAVE_APPROVAL_FORBIDDEN");
  });

  it("denies a bearer Teacher who is not the effective Operations Head", async () => {
    requireSchoolAccessOrOperationalCapabilityMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await leavePATCH(leaveReq({ status: "APPROVED" }), { params: Promise.resolve({ schoolId: "school-a", leaveId: "leave-1" }) });
    expect(res.status).toBe(403);
  });
});
