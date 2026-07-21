import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/student-mobile-auth", () => ({ getStudentAuth: vi.fn() }));
vi.mock("@/lib/parent-auth", () => ({ getAuthenticatedGuardian: vi.fn(), guardianCanAccessStudent: vi.fn(async () => true) }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/file-service", () => ({ resolveManagedOrLegacyUrl: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    homeworkStudentStatus: { findMany: vi.fn() },
    student: { findMany: vi.fn(async () => []) },
  },
}));

import { getStudentAuth } from "@/lib/student-mobile-auth";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";

const getStudentAuthMock = getStudentAuth as unknown as ReturnType<typeof vi.fn>;
const getGuardianMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;
const featureFlagMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as { homeworkStudentStatus: { findMany: ReturnType<typeof vi.fn> }; student: { findMany: ReturnType<typeof vi.fn> } };

const STUDENT_AUTH = { studentId: "stu-1", schoolId: "school-a" };

const SECTION = { name: "A", class: { name: "5" } };
const TEACHER = { id: "tch-1", name: "Ms. Rao" };

function statusRow(overrides: Partial<Record<string, unknown>> = {}) {
  const { homework: homeworkOverrides, ...topLevelOverrides } = overrides;
  return {
    id: "hss-1",
    homeworkId: "hw-1",
    studentId: "stu-1",
    submissionStatus: "CHECKED",
    submissionMethod: "PHYSICAL",
    submittedAt: new Date("2026-01-01T00:00:00Z"),
    checkedAt: new Date("2026-01-02T00:00:00Z"),
    score: 8,
    maxScore: 10,
    teacherRemark: "TOP SECRET: this student struggles and I suspect copying",
    studentFeedback: "Great effort, keep practicing decimals!",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    homework: {
      id: "hw-1",
      title: "Fractions",
      description: "Chapter 4",
      subject: "Math",
      dueDate: new Date("2026-01-01T00:00:00Z"),
      deadlineAt: new Date("2026-01-05T00:00:00Z"),
      checkingDeadlineAt: null,
      createdAt: new Date("2025-12-30T00:00:00Z"),
      assessmentMode: "GRADED",
      maxMarks: 10,
      status: "ACTIVE",
      teacher: TEACHER,
      section: SECTION,
      submissions: [],
      ...((homeworkOverrides as Record<string, unknown>) ?? {}),
    },
    ...topLevelOverrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getStudentAuthMock.mockResolvedValue(STUDENT_AUTH);
  getGuardianMock.mockResolvedValue({ guardian: { id: "g1", schoolId: "school-a" } });
  featureFlagMock.mockResolvedValue(null);
  p.student.findMany.mockResolvedValue([{ id: "stu-1" }]);
});

describe("GET /api/student/homework — private remarks never leak", () => {
  it("teacherRemark never appears anywhere in the response, studentFeedback does", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([statusRow()]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    const body = await res.json();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("TOP SECRET");
    expect(serialized).not.toContain("teacherRemark");
    expect(body.homework[0].studentFeedback).toBe("Great effort, keep practicing decimals!");
  });

  it("marks (score/maxScore/maxMarks) are shown for GRADED homework once checked", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([statusRow()]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    const body = await res.json();
    expect(body.homework[0].score).toBe(8);
    expect(body.homework[0].maxScore).toBe(10);
    expect(body.homework[0].maxMarks).toBe(10);
    expect(body.homework[0].assessmentMode).toBe("GRADED");
  });

  it("marks are never shown for CHECKING_ONLY homework, even if a legacy row happens to carry a stray score", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ homework: { assessmentMode: "CHECKING_ONLY", maxMarks: null } }),
    ]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    const body = await res.json();
    expect(body.homework[0].score).toBeNull();
    expect(body.homework[0].maxScore).toBeNull();
    expect(body.homework[0].maxMarks).toBeNull();
  });

  it("DRAFT homework is never visible to a student", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([statusRow({ homework: { status: "DRAFT" } })]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    const body = await res.json();
    expect(body.homework).toHaveLength(0);
  });

  it("SCHEDULED homework whose start date/time is still in the future is not visible", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ homework: { status: "SCHEDULED", dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000) } }),
    ]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    const body = await res.json();
    expect(body.homework).toHaveLength(0);
  });

  it("SCHEDULED homework whose start date/time has already passed IS visible", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ homework: { status: "SCHEDULED", dueDate: new Date(Date.now() - 60 * 1000) } }),
    ]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    const body = await res.json();
    expect(body.homework).toHaveLength(1);
  });

  it("CLOSED homework remains visible", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([statusRow({ homework: { status: "CLOSED" } })]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    const body = await res.json();
    expect(body.homework).toHaveLength(1);
  });

  it("feature flag disabled: no homework data is ever returned", async () => {
    const { NextResponse } = await import("next/server");
    featureFlagMock.mockResolvedValueOnce(NextResponse.json({ error: "Feature not enabled" }, { status: 403 }));
    p.homeworkStudentStatus.findMany.mockResolvedValue([statusRow()]);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    expect(res.status).toBe(403);
    expect(p.homeworkStudentStatus.findMany).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    getStudentAuthMock.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/parent/homework — private remarks never leak", () => {
  function parentReq() {
    return new NextRequest("http://localhost/api/parent/homework");
  }

  it("teacherRemark never appears anywhere in the response, studentFeedback does", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([{ ...statusRow(), student: { id: "stu-1", name: "Kid", rollNo: "1", section: SECTION } }]);
    const { GET } = await import("@/app/api/parent/homework/route");
    const res = await GET(parentReq());
    const body = await res.json();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("TOP SECRET");
    expect(serialized).not.toContain("teacherRemark");
    expect(body.homework[0].studentFeedback).toBe("Great effort, keep practicing decimals!");
  });

  it("DRAFT/future-SCHEDULED homework is never visible to a guardian", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      { ...statusRow({ homework: { status: "DRAFT" } }), student: { id: "stu-1", name: "Kid", rollNo: "1", section: SECTION } },
    ]);
    const { GET } = await import("@/app/api/parent/homework/route");
    const res = await GET(parentReq());
    const body = await res.json();
    expect(body.homework).toHaveLength(0);
  });

  it("rejects an unauthenticated request", async () => {
    getGuardianMock.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/parent/homework/route");
    const res = await GET(parentReq());
    expect(res.status).toBe(401);
  });
});
