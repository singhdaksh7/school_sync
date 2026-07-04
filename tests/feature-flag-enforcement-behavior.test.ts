import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── Shared mocks ─────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn(), findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    reportCard: { findMany: vi.fn() },
    examMilestone: { findMany: vi.fn(), findFirst: vi.fn() },
    homeworkStudentStatus: { findMany: vi.fn() },
    teacherCustomRole: { findFirst: vi.fn() },
    aIInsightCache: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn() }));
vi.mock("@/lib/school-access", () => ({ schoolLifecycleGate: vi.fn() }));
vi.mock("@/lib/teacher-authorization", () => ({
  requireTeacherPermission: vi.fn(),
  requireSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({
  sessionRole: (u: { role?: string }) => u?.role,
  canAccessSchool: vi.fn(),
  canWriteSchool: vi.fn(),
  teacherBelongsToSchool: vi.fn(),
}));
vi.mock("@/lib/homework", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/homework");
  return {
    ...actual,
    getTeacherByUserId: vi.fn(),
    getHomeworkForTeacherAccess: vi.fn(),
  };
});
vi.mock("@/lib/report-cards", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/report-cards");
  return { ...actual, getTeacherForSession: vi.fn() };
});
vi.mock("@/lib/student-mobile-auth", () => ({ getStudentAuth: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { schoolLifecycleGate } from "@/lib/school-access";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { canAccessSchool } from "@/lib/tenant";
import { getTeacherByUserId } from "@/lib/homework";
import { getTeacherForSession } from "@/lib/report-cards";
import { getStudentAuth } from "@/lib/student-mobile-auth";

const featureMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const lifecycleMock = schoolLifecycleGate as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;
const canAccessMock = canAccessSchool as unknown as ReturnType<typeof vi.fn>;
const getTeacherMock = getTeacherByUserId as unknown as ReturnType<typeof vi.fn>;
const getTeacherForSessionMock = getTeacherForSession as unknown as ReturnType<typeof vi.fn>;
const getStudentAuthMock = getStudentAuth as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const denied403 = () => NextResponse.json({ error: "Feature is not enabled for this school" }, { status: 403 });

function jsonRequest(url: string, body?: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", role: "TEACHER" } });
  lifecycleMock.mockResolvedValue(null);
  teacherPermMock.mockResolvedValue(null);
  canAccessMock.mockResolvedValue(true);
  featureMock.mockResolvedValue(null); // enabled by default
});

// ── HOMEWORK: nested teacher scoring route ───────────────────────────────────
describe("HOMEWORK enforcement — nested teacher scoring route", () => {
  it("HOMEWORK=false returns 403 BEFORE the RBAC permission check (RBAC cannot override a disabled feature)", async () => {
    getTeacherMock.mockResolvedValue({ id: "t1", schoolId: "s1" });
    featureMock.mockResolvedValueOnce(denied403());

    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/scores/route");
    const res = await POST(jsonRequest("http://localhost/api/teacher/homework/hw1/scores", { scores: [] }), {
      params: Promise.resolve({ homeworkId: "hw1" }),
    });

    expect(res.status).toBe(403);
    // Feature is the OUTER boundary: RBAC never consulted once the module is off.
    expect(teacherPermMock).not.toHaveBeenCalled();
    // Feature was checked against the identity-derived school, not client input.
    expect(featureMock).toHaveBeenCalledWith("s1", "HOMEWORK");
  });
});

// ── HOMEWORK: student route derives schoolId from identity ────────────────────
describe("HOMEWORK enforcement — student route derives schoolId from identity", () => {
  it("uses the authenticated student's schoolId (never a client-supplied one) and blocks when disabled", async () => {
    getStudentAuthMock.mockResolvedValue({ studentId: "stu1", schoolId: "authoritative-school", sectionId: "sec1" });
    featureMock.mockResolvedValueOnce(denied403());

    const { GET } = await import("@/app/api/student/homework/route");
    // Attacker tries to smuggle a different school via query string — must be ignored.
    const res = await GET(
      new Request("http://localhost/api/student/homework?schoolId=attacker-school") as never
    );

    expect(res.status).toBe(403);
    expect(featureMock).toHaveBeenCalledWith("authoritative-school", "HOMEWORK");
    expect(p.homeworkStudentStatus.findMany).not.toHaveBeenCalled();
  });

  it("HOMEWORK enabled preserves normal student access", async () => {
    getStudentAuthMock.mockResolvedValue({ studentId: "stu1", schoolId: "s1", sectionId: "sec1" });
    p.homeworkStudentStatus.findMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/student/homework/route");
    const res = await GET(new Request("http://localhost/api/student/homework") as never);

    expect(res.status).toBe(200);
    expect(featureMock).toHaveBeenCalledWith("s1", "HOMEWORK");
  });
});

// ── REPORT_CARDS: teacher route ──────────────────────────────────────────────
describe("REPORT_CARDS enforcement — teacher route", () => {
  it("REPORT_CARDS=false blocks and derives the school from the authenticated teacher", async () => {
    getTeacherForSessionMock.mockResolvedValue({ id: "t1", schoolId: "s1", mentorSectionId: "sec1", mentorSection: {} });
    featureMock.mockResolvedValueOnce(denied403());

    const { GET } = await import("@/app/api/teacher/report-cards/route");
    const res = await GET();

    expect(res.status).toBe(403);
    expect(featureMock).toHaveBeenCalledWith("s1", "REPORT_CARDS");
    expect(teacherPermMock).not.toHaveBeenCalled();
  });
});

// ── NOTEBOOK_CHECKING: teacher notebook route ────────────────────────────────
describe("NOTEBOOK_CHECKING enforcement — teacher notebook route", () => {
  it("NOTEBOOK_CHECKING=false blocks the notebook roster GET", async () => {
    getTeacherMock.mockResolvedValue({ id: "t1", schoolId: "s1" });
    featureMock.mockResolvedValueOnce(denied403());

    const { GET } = await import("@/app/api/teacher/notebook/route");
    const res = await GET(new Request("http://localhost/api/teacher/notebook?sectionId=sec1&subject=Math&examMilestoneId=m1"));

    expect(res.status).toBe(403);
    expect(featureMock).toHaveBeenCalledWith("s1", "NOTEBOOK_CHECKING");
    expect(teacherPermMock).not.toHaveBeenCalled();
  });
});

// ── ANALYTICS: school dashboard analytics ────────────────────────────────────
describe("ANALYTICS enforcement — school analytics route", () => {
  it("ANALYTICS=false blocks the analytics dashboard", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SCHOOL_ADMIN" } });
    p.school.findUnique.mockResolvedValue({ ownerId: "u1", admins: [] });
    featureMock.mockResolvedValueOnce(denied403());

    const { GET } = await import("@/app/api/schools/[schoolId]/analytics/route");
    const res = await GET(new Request("http://localhost/api/schools/s1/analytics"), {
      params: Promise.resolve({ schoolId: "s1" }),
    });

    expect(res.status).toBe(403);
    expect(featureMock).toHaveBeenCalledWith("s1", "ANALYTICS");
  });
});

// ── AI_FEATURES: ai-insights ─────────────────────────────────────────────────
describe("AI_FEATURES enforcement — ai-insights route", () => {
  it("AI_FEATURES=false blocks the AI insights endpoint", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SCHOOL_ADMIN" } });
    p.school.findUnique.mockResolvedValue({ id: "s1", ownerId: "u1", name: "Test" });
    p.user.findFirst.mockResolvedValue({ id: "u1" });
    featureMock.mockResolvedValueOnce(denied403());

    const { POST } = await import("@/app/api/ai-insights/route");
    const res = await POST(jsonRequest("http://localhost/api/ai-insights", { schoolId: "s1" }));

    expect(res.status).toBe(403);
    expect(featureMock).toHaveBeenCalledWith("s1", "AI_FEATURES");
    expect(p.aIInsightCache.findUnique).not.toHaveBeenCalled();
  });
});
