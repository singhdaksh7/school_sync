import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findMany: vi.fn() },
    studentGuardian: { findFirst: vi.fn(), findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/parent-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/parent-auth")>("@/lib/parent-auth");
  return { ...actual, getAuthenticatedGuardian: vi.fn() };
});
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
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { resolveEffectiveOperationalRole } from "@/lib/operational-role-resolver";

const p = prisma as unknown as {
  student: { findMany: ReturnType<typeof vi.fn> };
  studentGuardian: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  leaveRequest: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  notification: { create: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
};
const getAuthMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;
const resolveEffectiveOperationalRoleMock = resolveEffectiveOperationalRole as unknown as ReturnType<typeof vi.fn>;

const GUARDIAN_AUTH = { decoded: { guardianId: "g1", schoolId: "school-a" }, guardian: { id: "g1", schoolId: "school-a" } };

const CHILD_A = { id: "child-a", name: "Alice", rollNo: "1", section: { name: "A", class: { name: "5" } } };
const CHILD_B = { id: "child-b", name: "Bob", rollNo: "2", section: { name: "B", class: { name: "6" } } };

function jsonReq(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  getAuthMock.mockResolvedValue(GUARDIAN_AUTH);
  p.leaveRequest.findMany.mockResolvedValue([]);
  p.leaveRequest.create.mockResolvedValue({ id: "leave-1", status: "PENDING" });
  p.studentGuardian.findMany.mockResolvedValue([]);
  p.user.findMany.mockResolvedValue([]);
  resolveEffectiveOperationalRoleMock.mockResolvedValue({
    roleType: "TEACHER_OPERATIONS",
    dateKey: "2026-07-17",
    effectiveTeacher: null,
    effectiveAssignmentId: null,
    effectivePriority: null,
    assignmentType: null,
    primaryTeacher: null,
    reasonCode: "NO_ASSIGNMENTS_CONFIGURED",
    chain: [],
  });
});

describe("GET /api/parent/leave — multi-child access", () => {
  it("lists leave requests for every linked child when no studentId is given", async () => {
    p.student.findMany.mockResolvedValue([CHILD_A, CHILD_B]);
    const { GET } = await import("@/app/api/parent/leave/route");
    const res = await GET(new NextRequest("http://localhost/api/parent/leave"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.children).toHaveLength(2);
    expect(p.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ studentId: { in: ["child-a", "child-b"] }, schoolId: "school-a" }) })
    );
  });

  it("narrows to one child when studentId is a real linked child", async () => {
    p.studentGuardian.findFirst.mockResolvedValue({ studentId: "child-a" });
    p.student.findMany.mockResolvedValue([CHILD_A]);
    const { GET } = await import("@/app/api/parent/leave/route");
    const res = await GET(new NextRequest("http://localhost/api/parent/leave?studentId=child-a"));
    expect(res.status).toBe(200);
  });

  it("returns a non-enumerating 404 for a studentId that is not actually linked to this guardian", async () => {
    p.studentGuardian.findFirst.mockResolvedValue(null);
    const { GET } = await import("@/app/api/parent/leave/route");
    const res = await GET(new NextRequest("http://localhost/api/parent/leave?studentId=unrelated-child"));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Student not found");
  });

  it("rejects an unauthenticated request", async () => {
    getAuthMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/parent/leave/route");
    const res = await GET(new NextRequest("http://localhost/api/parent/leave"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/parent/leave — submit for a linked child only", () => {
  it("creates a STUDENT leave request scoped to the server-resolved school, for a verified linked child", async () => {
    p.studentGuardian.findFirst.mockResolvedValue({ studentId: "child-a" });
    const { POST } = await import("@/app/api/parent/leave/route");
    const res = await POST(
      jsonReq("http://localhost/api/parent/leave", {
        studentId: "child-a",
        leaveType: "Sick Leave",
        reason: "Fever",
        fromDate: "2099-01-10",
        toDate: "2099-01-12",
      }) as never
    );
    expect(res.status).toBe(201);
    expect(p.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "STUDENT", studentId: "child-a", schoolId: "school-a" }) })
    );
  });

  it("rejects submitting leave for a child that is not actually linked to this guardian (non-enumerating)", async () => {
    p.studentGuardian.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/parent/leave/route");
    const res = await POST(
      jsonReq("http://localhost/api/parent/leave", {
        studentId: "unrelated-child",
        leaveType: "Sick Leave",
        reason: "Fever",
        fromDate: "2099-01-10",
        toDate: "2099-01-12",
      }) as never
    );
    expect(res.status).toBe(404);
    expect(p.leaveRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied schoolId, status, or reviewedById via strict schema validation", async () => {
    p.studentGuardian.findFirst.mockResolvedValue({ studentId: "child-a" });
    const { POST } = await import("@/app/api/parent/leave/route");
    const res = await POST(
      jsonReq("http://localhost/api/parent/leave", {
        studentId: "child-a",
        schoolId: "some-other-school",
        status: "APPROVED",
        reviewedById: "admin-1",
        leaveType: "Sick Leave",
        reason: "Fever",
        fromDate: "2099-01-10",
        toDate: "2099-01-12",
      }) as never
    );
    expect(res.status).toBe(400);
    expect(p.leaveRequest.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid date range the same way /api/student/leave does (shared validation)", async () => {
    p.studentGuardian.findFirst.mockResolvedValue({ studentId: "child-a" });
    const { POST } = await import("@/app/api/parent/leave/route");
    const res = await POST(
      jsonReq("http://localhost/api/parent/leave", {
        studentId: "child-a",
        leaveType: "Sick Leave",
        reason: "Fever",
        fromDate: "2099-01-12",
        toDate: "2099-01-10",
      }) as never
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("To date must be on or after from date");
  });
});
