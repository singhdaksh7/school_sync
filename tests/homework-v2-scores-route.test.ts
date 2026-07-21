import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/homework", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/homework");
  return { ...actual, getTeacherByUserId: vi.fn(), getHomeworkForTeacherAccess: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { count: vi.fn() },
    homeworkSubmission: { findMany: vi.fn(async () => []), upsert: vi.fn() },
    homeworkStudentStatus: { update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txProxy)),
  },
}));

import { getTeacherAuth } from "@/lib/mobile-auth";
import { getHomeworkForTeacherAccess, getTeacherByUserId } from "@/lib/homework";
import { prisma } from "@/lib/prisma";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const getTeacherByUserIdMock = getTeacherByUserId as unknown as ReturnType<typeof vi.fn>;
const getHomeworkForTeacherAccessMock = getHomeworkForTeacherAccess as unknown as ReturnType<typeof vi.fn>;

const txProxy = {
  homeworkStudentStatus: { update: vi.fn(async () => ({})) },
  homeworkSubmission: { upsert: vi.fn(async () => ({})) },
};

const p = prisma as unknown as { student: { count: ReturnType<typeof vi.fn> } };

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a" };
const CHECKING_HOMEWORK = {
  id: "hw-1",
  schoolId: "school-a",
  sectionId: "sec-1",
  status: "ACTIVE",
  assessmentMode: "CHECKING_ONLY",
  maxMarks: null,
  deadlineAt: new Date("2099-01-01T00:00:00Z"),
};
const GRADED_HOMEWORK = { ...CHECKING_HOMEWORK, assessmentMode: "GRADED", maxMarks: 20 };

function scoresReq(scores: unknown[]) {
  return new Request("http://localhost/api/teacher/homework/hw-1/scores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scores }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  getTeacherByUserIdMock.mockResolvedValue(TEACHER_ROW);
  p.student.count.mockResolvedValue(1);
  txProxy.homeworkStudentStatus.update.mockResolvedValue({});
  txProxy.homeworkSubmission.upsert.mockResolvedValue({});
});

describe("POST /api/teacher/homework/[homeworkId]/scores — assessment-mode boundary", () => {
  it("CHECKING_ONLY homework rejects any score, even when the client tries to sneak one in via status=CHECKED", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(CHECKING_HOMEWORK);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(
      scoresReq([{ studentId: "stu-1", status: "CHECKED", score: 5, maxScore: 10 }]),
      { params: Promise.resolve({ homeworkId: "hw-1" }) }
    );
    expect(res.status).toBe(400);
    expect(txProxy.homeworkStudentStatus.update).not.toHaveBeenCalled();
  });

  it("CHECKING_ONLY homework accepts CHECKED with no score at all (ordinary notebook/completion checking)", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(CHECKING_HOMEWORK);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-1", status: "CHECKED" }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(200);
    expect(txProxy.homeworkStudentStatus.update).toHaveBeenCalled();
  });

  it("GRADED homework requires a score when marking CHECKED", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(GRADED_HOMEWORK);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-1", status: "CHECKED" }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("GRADED homework accepts an in-bounds score", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(GRADED_HOMEWORK);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-1", status: "CHECKED", score: 15, maxScore: 20 }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(200);
  });

  it("GRADED homework rejects a score above the homework's own maxMarks, even if a stray per-row maxScore would have allowed it", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(GRADED_HOMEWORK);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-1", status: "CHECKED", score: 25, maxScore: 30 }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("GRADED homework distinguishes a legitimate checked zero from not-checked (zero is accepted, not treated as absent)", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(GRADED_HOMEWORK);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-1", status: "CHECKED", score: 0, maxScore: 20 }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(200);
  });

  it("cancelled homework cannot be scored", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue({ ...GRADED_HOMEWORK, status: "CANCELLED" });
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-1", status: "CHECKED", score: 5, maxScore: 20 }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects scores for a student not enrolled in this homework's section (tenant/roster isolation)", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(GRADED_HOMEWORK);
    p.student.count.mockResolvedValue(0);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-outsider", status: "CHECKED", score: 5, maxScore: 20 }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("cross-school IDOR: a homework not accessible to this teacher returns 404", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(scoresReq([{ studentId: "stu-1", status: "CHECKED", score: 5, maxScore: 20 }]), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(404);
  });
});
