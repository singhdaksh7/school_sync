import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teacher: { findUnique: vi.fn() },
    leaveRequest: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";

const p = prisma as unknown as {
  teacher: { findUnique: ReturnType<typeof vi.fn> };
  leaveRequest: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};
const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a" };

function jsonReq(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  p.teacher.findUnique.mockResolvedValue(TEACHER_ROW);
  p.leaveRequest.findMany.mockResolvedValue([]);
});

describe("Teacher personal leave — self-only", () => {
  it("a bearer Teacher can view their own leave requests, scoped by their own teacherId", async () => {
    const { GET } = await import("@/app/api/teacher/leaves/route");
    const res = await GET(new Request("http://localhost/api/teacher/leaves", { headers: { Authorization: "Bearer x" } }));
    expect(res.status).toBe(200);
    expect(p.leaveRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teacherId: "teacher-1", schoolId: "school-a" } }));
  });

  it("a bearer Teacher can create their own leave request", async () => {
    p.leaveRequest.create.mockResolvedValue({ id: "leave-1", status: "PENDING" });
    const { POST } = await import("@/app/api/teacher/leaves/route");
    const res = await POST(jsonReq("http://localhost/api/teacher/leaves", { reason: "Medical", fromDate: "2026-07-10", toDate: "2026-07-12" }));
    expect(res.status).toBe(201);
    expect(p.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ teacherId: "teacher-1", schoolId: "school-a", type: "TEACHER" }) })
    );
  });

  it("rejects an invalid date range (toDate before fromDate) — unchanged validation", async () => {
    const { POST } = await import("@/app/api/teacher/leaves/route");
    const res = await POST(jsonReq("http://localhost/api/teacher/leaves", { reason: "X", fromDate: "2026-07-12", toDate: "2026-07-10" }));
    expect(res.status).toBe(400);
  });

  it("unauthenticated request is denied", async () => {
    getTeacherAuthMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/teacher/leaves/route");
    const res = await GET(new Request("http://localhost/api/teacher/leaves"));
    expect(res.status).toBe(401);
  });

  it("this route exposes no approval capability — no status-update handler exists (personal leave only, distinct from Operations leave approval)", async () => {
    const route = await import("@/app/api/teacher/leaves/route");
    expect((route as { PATCH?: unknown; PUT?: unknown }).PATCH).toBeUndefined();
    expect((route as { PATCH?: unknown; PUT?: unknown }).PUT).toBeUndefined();
  });
});
