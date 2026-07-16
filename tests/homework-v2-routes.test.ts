import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/homework", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/homework");
  return {
    ...actual,
    getTeacherByUserId: vi.fn(),
    getHomeworkForTeacherAccess: vi.fn(),
    validateHomeworkTeacherAssignment: vi.fn(async () => null),
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    homework: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    homeworkStudentStatus: { createMany: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []) },
    homeworkSubmission: { findMany: vi.fn(async () => []), upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      if (typeof fn === "function") return fn(txProxy);
      return Promise.all(fn as Promise<unknown>[]);
    }),
  },
}));

import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { getHomeworkForTeacherAccess, getTeacherByUserId, validateHomeworkTeacherAssignment } from "@/lib/homework";
import { prisma } from "@/lib/prisma";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const featureFlagMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;
const getTeacherByUserIdMock = getTeacherByUserId as unknown as ReturnType<typeof vi.fn>;
const getHomeworkForTeacherAccessMock = getHomeworkForTeacherAccess as unknown as ReturnType<typeof vi.fn>;
const assignmentValidMock = validateHomeworkTeacherAssignment as unknown as ReturnType<typeof vi.fn>;

// A minimal stand-in transaction client — every test that reaches a
// $transaction callback just needs create/update/findUnique to resolve.
const txProxy = {
  homework: {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "hw-new", ...args.data })),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "hw-1", ...args.data })),
    findUnique: vi.fn(async () => ({ id: "hw-new", status: "ACTIVE", assessmentMode: "CHECKING_ONLY" })),
  },
  homeworkStudentStatus: {
    createMany: vi.fn(async () => ({ count: 0 })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  homeworkSubmission: { updateMany: vi.fn(async () => ({ count: 0 })) },
  student: { findMany: vi.fn(async () => []) },
};

const p = prisma as unknown as {
  student: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  homework: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a" };

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/teacher/homework", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  getTeacherByUserIdMock.mockResolvedValue(TEACHER_ROW);
  featureFlagMock.mockResolvedValue(null);
  teacherPermMock.mockResolvedValue(null);
  assignmentValidMock.mockResolvedValue(null);
  p.student.findMany.mockResolvedValue([]);
  p.student.count.mockResolvedValue(0);
  txProxy.homework.findUnique.mockResolvedValue({
    id: "hw-new",
    status: "ACTIVE",
    assessmentMode: "CHECKING_ONLY",
    title: "HW",
    subject: "Math",
    sectionId: "sec-1",
  } as never);
});

describe("POST /api/teacher/homework — Homework 2.0 create", () => {
  it("creates checking-only homework by default (no assessmentMode/maxMarks sent) and rejects nothing", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
      })
    );
    expect(res.status).toBe(201);
    expect(txProxy.homework.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assessmentMode: "CHECKING_ONLY", maxMarks: null, status: "ACTIVE" }) })
    );
  });

  it("creates graded homework with a positive maxMarks", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
        assessmentMode: "GRADED",
        maxMarks: 20,
      })
    );
    expect(res.status).toBe(201);
    expect(txProxy.homework.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assessmentMode: "GRADED", maxMarks: 20 }) })
    );
  });

  it("rejects graded homework with no maxMarks", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
        assessmentMode: "GRADED",
      })
    );
    expect(res.status).toBe(400);
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });

  it("rejects graded homework with maxMarks <= 0", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
        assessmentMode: "GRADED",
        maxMarks: 0,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects checking-only homework that supplies maxMarks", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
        assessmentMode: "CHECKING_ONLY",
        maxMarks: 10,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a start date on/after the submission deadline", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-05T00:00:00.000Z",
        deadlineAt: "2026-01-01T00:00:00.000Z",
      })
    );
    expect(res.status).toBe(400);
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });

  it("rejects a checking deadline before the submission deadline", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-05T00:00:00.000Z",
        checkingDeadlineAt: "2026-01-03T00:00:00.000Z",
      })
    );
    expect(res.status).toBe(400);
  });

  it("no silent default: omitting deadlineAt is rejected outright, never defaulted to dueDate", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(jsonReq("POST", { sectionId: "sec-1", subject: "Math", title: "HW", dueDate: "2026-01-01T00:00:00.000Z" }));
    expect(res.status).toBe(400);
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });

  it("no silent default: an empty-string deadlineAt is also rejected, not treated as omitted-then-defaulted", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", { sectionId: "sec-1", subject: "Math", title: "HW", dueDate: "2026-01-01T00:00:00.000Z", deadlineAt: "" })
    );
    expect(res.status).toBe(400);
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });

  it("teacher class/subject authorization: denies creation when the teacher isn't assigned to teach this subject/section", async () => {
    assignmentValidMock.mockResolvedValueOnce("Teacher is not assigned to teach this subject in this section");
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
      })
    );
    expect(res.status).toBe(403);
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });

  it("school tenant isolation: schoolId is always the authenticated teacher's own school, never a client-supplied value (schema has no such field, and it's forbidden by .strict())", async () => {
    const { POST } = await import("@/app/api/teacher/homework/route");
    await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
        schoolId: "attacker-school",
      })
    );
    // The extra field makes the whole request invalid (Zod .strict()) — the
    // route never reaches transaction/create with an attacker-controlled
    // schoolId either way.
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });

  it("feature flag disabled: HOMEWORK feature gate is checked before any DB write", async () => {
    featureFlagMock.mockResolvedValueOnce(NextResponse.json({ error: "Feature not enabled" }, { status: 403 }));
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
      })
    );
    expect(res.status).toBe(403);
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    getTeacherAuthMock.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/teacher/homework/route");
    const res = await POST(
      jsonReq("POST", {
        sectionId: "sec-1",
        subject: "Math",
        title: "HW",
        dueDate: "2026-01-01T00:00:00.000Z",
        deadlineAt: "2026-01-02T00:00:00.000Z",
      })
    );
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/teacher/homework/[homeworkId] — Homework 2.0 lifecycle", () => {
  const EXISTING = {
    id: "hw-1",
    schoolId: "school-a",
    sectionId: "sec-1",
    subject: "Math",
    status: "ACTIVE",
    assessmentMode: "CHECKING_ONLY",
    maxMarks: null,
    dueDate: new Date("2026-01-01T00:00:00.000Z"),
    deadlineAt: new Date("2026-01-02T00:00:00.000Z"),
    checkingDeadlineAt: null,
  };

  function patchReq(body: unknown) {
    return new Request("http://localhost/api/teacher/homework/hw-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(EXISTING);
    txProxy.homework.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...EXISTING, ...args.data }));
    txProxy.homework.findUnique.mockImplementation(async () => ({ ...EXISTING }));
  });

  it("cross-school IDOR: a homework not owned/accessible by this teacher's school returns 404, never leaks existence", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValueOnce(null);
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ title: "New title" }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(404);
  });

  it("cancelled homework cannot receive any update", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValueOnce({ ...EXISTING, status: "CANCELLED" });
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ title: "New title" }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(400);
  });

  it("closed homework is a terminal state — cannot transition back to ACTIVE", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValueOnce({ ...EXISTING, status: "CLOSED" });
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ status: "ACTIVE" }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(400);
  });

  it("DRAFT can be published directly to ACTIVE", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValueOnce({ ...EXISTING, status: "DRAFT" });
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ status: "ACTIVE" }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(200);
  });

  it("cannot edit assessmentMode to GRADED without also supplying a valid maxMarks", async () => {
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ assessmentMode: "GRADED" }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(400);
  });

  it("teacher class/subject re-authorization on section/subject change", async () => {
    assignmentValidMock.mockResolvedValueOnce("Teacher is not assigned to teach this subject in this section");
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ subject: "Science" }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/teacher/homework/[homeworkId] — clearing marks on GRADED to CHECKING_ONLY", () => {
  const GRADED_EXISTING = {
    id: "hw-1",
    schoolId: "school-a",
    sectionId: "sec-1",
    subject: "Math",
    status: "ACTIVE",
    assessmentMode: "GRADED",
    maxMarks: 20,
    dueDate: new Date("2026-01-01T00:00:00.000Z"),
    deadlineAt: new Date("2026-01-02T00:00:00.000Z"),
    checkingDeadlineAt: null,
  };

  function patchReq(body: unknown) {
    return new Request("http://localhost/api/teacher/homework/hw-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(GRADED_EXISTING);
    txProxy.homework.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...GRADED_EXISTING, ...args.data }));
    txProxy.homework.findUnique.mockImplementation(async () => ({ ...GRADED_EXISTING, assessmentMode: "CHECKING_ONLY", maxMarks: null }));
  });

  it("(a) GRADED -> CHECKING_ONLY clears score/maxScore on both HomeworkStudentStatus and HomeworkSubmission, atomically with the mode change", async () => {
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ assessmentMode: "CHECKING_ONLY", maxMarks: null }), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(200);
    expect(txProxy.homeworkStudentStatus.updateMany).toHaveBeenCalledWith({
      where: { homeworkId: "hw-1" },
      data: { score: null, maxScore: null },
    });
    expect(txProxy.homeworkSubmission.updateMany).toHaveBeenCalledWith({
      where: { homeworkId: "hw-1" },
      data: { score: null, maxScore: null },
    });
    // Both clears happen inside the same $transaction callback as the mode
    // change itself — see the single prisma.$transaction call in the route.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("(b) other edits (e.g. title-only, or staying GRADED) never touch marks", async () => {
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    txProxy.homework.findUnique.mockImplementation(async () => ({ ...GRADED_EXISTING, title: "New title" }));
    const res = await PATCH(patchReq({ title: "New title" }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(200);
    expect(txProxy.homeworkStudentStatus.updateMany).not.toHaveBeenCalled();
    expect(txProxy.homeworkSubmission.updateMany).not.toHaveBeenCalled();
  });

  it("(b) raising maxMarks while remaining GRADED never clears marks", async () => {
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    txProxy.homework.findUnique.mockImplementation(async () => ({ ...GRADED_EXISTING, maxMarks: 50 }));
    const res = await PATCH(patchReq({ maxMarks: 50 }), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(200);
    expect(txProxy.homeworkStudentStatus.updateMany).not.toHaveBeenCalled();
    expect(txProxy.homeworkSubmission.updateMany).not.toHaveBeenCalled();
  });

  it("(c) a failure partway through the transition rolls back the whole thing — the callback throws instead of completing partial writes", async () => {
    txProxy.homeworkSubmission.updateMany.mockRejectedValueOnce(new Error("db error"));
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    await expect(
      PATCH(patchReq({ assessmentMode: "CHECKING_ONLY", maxMarks: null }), { params: Promise.resolve({ homeworkId: "hw-1" }) })
    ).rejects.toThrow("db error");
    // Every write for this transition — the homework update and both mark
    // clears — happens inside one $transaction callback, so a Prisma
    // interactive transaction rolls all of it back together on this throw.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("(d) the teacher-facing PATCH response itself reflects the cleared marks — no stale score/maxScore in studentStatuses/submissions", async () => {
    txProxy.homework.findUnique.mockImplementation(async () => ({
      ...GRADED_EXISTING,
      assessmentMode: "CHECKING_ONLY",
      maxMarks: null,
      studentStatuses: [{ id: "status-1", studentId: "stu-1", score: null, maxScore: null }],
      submissions: [{ id: "sub-1", studentId: "stu-1", score: null, maxScore: null }],
    }));
    const { PATCH } = await import("@/app/api/teacher/homework/[homeworkId]/route");
    const res = await PATCH(patchReq({ assessmentMode: "CHECKING_ONLY", maxMarks: null }), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    const body = await res.json();
    expect(body.studentStatuses.every((s: { score: number | null }) => s.score === null)).toBe(true);
    expect(body.submissions.every((s: { score: number | null }) => s.score === null)).toBe(true);
  });
});

describe("POST /api/teacher/homework/[homeworkId]/duplicate", () => {
  const SOURCE = {
    id: "hw-1",
    schoolId: "school-a",
    sectionId: "sec-1",
    subject: "Math",
    title: "Original",
    description: null,
    status: "ACTIVE",
    assessmentMode: "GRADED",
    maxMarks: 20,
    dueDate: new Date("2026-01-01T00:00:00.000Z"),
    deadlineAt: new Date("2026-01-02T00:00:00.000Z"),
    checkingDeadlineAt: null,
  };

  beforeEach(() => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(SOURCE);
    txProxy.homework.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "hw-2", ...args.data }));
    txProxy.homework.findUnique.mockImplementation(async () => ({ id: "hw-2", status: "DRAFT", assessmentMode: "GRADED", maxMarks: 20 }));
  });

  function dupReq() {
    return new Request("http://localhost/api/teacher/homework/hw-1/duplicate", { method: "POST" });
  }

  it("duplicates into a new DRAFT, preserving assessmentMode/maxMarks but never carrying over roster state", async () => {
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/duplicate/route");
    const res = await POST(dupReq(), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(201);
    expect(txProxy.homework.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT", assessmentMode: "GRADED", maxMarks: 20, title: expect.stringContaining("Original") }),
      })
    );
  });

  it("cross-school IDOR: duplicating a homework this teacher cannot access returns 404", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/duplicate/route");
    const res = await POST(dupReq(), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(404);
    expect(txProxy.homework.create).not.toHaveBeenCalled();
  });
});
