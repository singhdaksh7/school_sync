import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Business-rule preservation for the newly bearer-compatible homework family
// routes. Auth-transport equivalence itself is proven once, exhaustively, in
// tests/teacher-bearer-auth-equivalence.test.ts (same getTeacherAuth for
// every route) — this file focuses on the rules that must be UNCHANGED.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    homeworkSubmission: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    homeworkStudentStatus: { update: vi.fn(), findMany: vi.fn() },
    student: { count: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(prismaTx))),
  },
}));
const prismaTx = {
  homework: { update: vi.fn(), findUnique: vi.fn() },
  homeworkStudentStatus: { deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  homeworkSubmission: { update: vi.fn(), upsert: vi.fn() },
  student: { findMany: vi.fn() },
};
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/homework", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/homework");
  return {
    ...actual,
    getTeacherByUserId: vi.fn(),
    getHomeworkForTeacherAccess: vi.fn(),
  };
});
vi.mock("@/lib/file-service", () => ({ resolveManagedOrLegacyUrl: vi.fn(async () => null) }));

import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { getHomeworkForTeacherAccess, getTeacherByUserId } from "@/lib/homework";

const p = prisma as unknown as {
  homeworkSubmission: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  student: { count: ReturnType<typeof vi.fn> };
};
const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const getTeacherByUserIdMock = getTeacherByUserId as unknown as ReturnType<typeof vi.fn>;
const getHomeworkForTeacherAccessMock = getHomeworkForTeacherAccess as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a" };
const HOMEWORK = {
  id: "hw-1",
  schoolId: "school-a",
  sectionId: "sec-1",
  subject: "Math",
  status: "ACTIVE",
  dueDate: new Date("2026-01-01"),
  deadlineAt: new Date("2026-01-01"),
};

function jsonReq(url: string, body: unknown, method = "PATCH") {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  getTeacherByUserIdMock.mockResolvedValue(TEACHER_ROW);
  getHomeworkForTeacherAccessMock.mockResolvedValue(HOMEWORK);
  teacherPermMock.mockResolvedValue(null);
});

describe("Homework edit — cross-teacher denial preserved", () => {
  it("a Teacher without ownership/assignment for this homework is denied (getHomeworkForTeacherAccess returns null)", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(null); // simulates another teacher's unauthorized homework
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(jsonReq("http://localhost/api/teacher/homework/hw-1", { title: "New title" }), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("HOMEWORK:EDIT permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(jsonReq("http://localhost/api/teacher/homework/hw-1", { title: "X" }), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("Homework submissions — Teacher scope preserved", () => {
  it("returns only submissions for the teacher's own section", async () => {
    p.homeworkSubmission.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/teacher/homework/[homeworkId]/submissions/route");
    const res = await GET(new Request("http://localhost/api/teacher/homework/hw-1/submissions"), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(200);
    expect(p.homeworkSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ homeworkId: "hw-1", schoolId: "school-a" }) })
    );
  });

  it("unauthorized homework access is denied before any submission query runs", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/teacher/homework/[homeworkId]/submissions/route");
    const res = await GET(new Request("http://localhost/api/teacher/homework/hw-1/submissions"), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(404);
    expect(p.homeworkSubmission.findMany).not.toHaveBeenCalled();
  });
});

describe("Homework single-submission scoring — rules unchanged", () => {
  it("rejecting without a teacherRemark is still rejected", async () => {
    p.homeworkSubmission.findFirst.mockResolvedValue({ id: "sub-1", studentId: "stu-1", submissionMethod: "ONLINE", submittedAt: new Date() });
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/submissions/[submissionId]/route");
    const res = await PATCH(jsonReq("http://localhost/x", { status: "REJECTED" }), {
      params: Promise.resolve({ homeworkId: "hw-1", submissionId: "sub-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("REVIEW permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/submissions/[submissionId]/route");
    const res = await PATCH(jsonReq("http://localhost/x", { status: "REVIEWED", score: 8, maxScore: 10 }), {
      params: Promise.resolve({ homeworkId: "hw-1", submissionId: "sub-1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("Homework batch scores — validation unchanged", () => {
  it("requires at least one score entry", async () => {
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(jsonReq("http://localhost/x", { scores: [] }, "POST"), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("cancelled homework cannot be scored", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue({ ...HOMEWORK, status: "CANCELLED" });
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(jsonReq("http://localhost/x", { scores: [{ studentId: "s1", status: "CHECKED", score: 5, maxScore: 10 }] }, "POST"), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Homework completion — rules unchanged", () => {
  it("requires a boolean `completed` field per entry", async () => {
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/completion/route");
    const res = await PATCH(jsonReq("http://localhost/x", { completions: [{ studentId: "s1", completed: "yes" }] }), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Homework class dashboard — scope unchanged", () => {
  it("requires sectionId and subject query params", async () => {
    const { GET } = await import("@/app/api/teacher/homework/class-dashboard/route");
    const res = await GET(new Request("http://localhost/api/teacher/homework/class-dashboard"));
    expect(res.status).toBe(400);
  });
});
