import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/student-mobile-auth", () => ({ getStudentAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { homeworkStudentStatus: { findMany: vi.fn() } },
}));

import { getStudentAuth } from "@/lib/student-mobile-auth";
import { prisma } from "@/lib/prisma";

const getStudentAuthMock = getStudentAuth as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as { homeworkStudentStatus: { findMany: ReturnType<typeof vi.fn> } };

const AUTH = { studentId: "stu-1", schoolId: "school-a" };
const NOW = new Date("2026-06-15T00:00:00.000Z");

function statusRow(overrides: {
  id: string;
  subject: string;
  status: string;
  dueDate: Date;
  submissionStatus: string;
  submissionMethod?: string;
  score?: number | null;
  maxScore?: number | null;
}) {
  return {
    submissionStatus: overrides.submissionStatus,
    submissionMethod: overrides.submissionMethod ?? "NONE",
    score: overrides.score ?? null,
    maxScore: overrides.maxScore ?? null,
    homework: { subject: overrides.subject, status: overrides.status, dueDate: overrides.dueDate },
  };
}

function req() {
  return new NextRequest("http://localhost/api/student/homework-summary");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getStudentAuthMock.mockResolvedValue(AUTH);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/student/homework-summary — scheduled-visibility parity with the detailed list", () => {
  it("excludes DRAFT homework from totals", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ id: "1", subject: "Math", status: "DRAFT", dueDate: new Date("2026-01-01"), submissionStatus: "PENDING" }),
    ]);
    const { GET } = await import("@/app/api/student/homework-summary/route");
    const body = await (await GET(req())).json();
    expect(body.totalAssigned).toBe(0);
  });

  it("excludes SCHEDULED homework whose start time has not yet arrived", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ id: "1", subject: "Math", status: "SCHEDULED", dueDate: new Date("2099-01-01"), submissionStatus: "PENDING" }),
    ]);
    const { GET } = await import("@/app/api/student/homework-summary/route");
    const body = await (await GET(req())).json();
    expect(body.totalAssigned).toBe(0);
  });

  it("includes SCHEDULED homework whose start time has already arrived (effectively ACTIVE)", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ id: "1", subject: "Math", status: "SCHEDULED", dueDate: new Date("2020-01-01"), submissionStatus: "SUBMITTED" }),
    ]);
    const { GET } = await import("@/app/api/student/homework-summary/route");
    const body = await (await GET(req())).json();
    expect(body.totalAssigned).toBe(1);
    expect(body.submittedCount).toBe(1);
  });

  it("includes ACTIVE homework", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ id: "1", subject: "Math", status: "ACTIVE", dueDate: new Date("2026-01-01"), submissionStatus: "PENDING" }),
    ]);
    const { GET } = await import("@/app/api/student/homework-summary/route");
    const body = await (await GET(req())).json();
    expect(body.totalAssigned).toBe(1);
  });

  it("excludes CANCELLED homework", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ id: "1", subject: "Math", status: "CANCELLED", dueDate: new Date("2026-01-01"), submissionStatus: "PENDING" }),
    ]);
    const { GET } = await import("@/app/api/student/homework-summary/route");
    const body = await (await GET(req())).json();
    expect(body.totalAssigned).toBe(0);
  });

  it("totals and completion percentages are computed from visible homework only, mixing all statuses", async () => {
    p.homeworkStudentStatus.findMany.mockResolvedValue([
      statusRow({ id: "1", subject: "Math", status: "DRAFT", dueDate: new Date("2026-01-01"), submissionStatus: "PENDING" }),
      statusRow({ id: "2", subject: "Math", status: "SCHEDULED", dueDate: new Date("2099-01-01"), submissionStatus: "PENDING" }),
      statusRow({ id: "3", subject: "Math", status: "ACTIVE", dueDate: new Date("2026-01-01"), submissionStatus: "SUBMITTED" }),
      statusRow({ id: "4", subject: "Science", status: "CLOSED", dueDate: new Date("2026-01-01"), submissionStatus: "NOT_SUBMITTED" }),
      statusRow({ id: "5", subject: "Science", status: "CANCELLED", dueDate: new Date("2026-01-01"), submissionStatus: "PENDING" }),
    ]);
    const { GET } = await import("@/app/api/student/homework-summary/route");
    const body = await (await GET(req())).json();
    // Only records #3 and #4 are visible — DRAFT, future-SCHEDULED, and
    // CANCELLED are all excluded.
    expect(body.totalAssigned).toBe(2);
    expect(body.completedCount).toBe(1);
    expect(body.completionPercentage).toBe(50);
    const mathSubject = body.subjectWiseSummary.find((s: { subject: string }) => s.subject === "Math");
    const scienceSubject = body.subjectWiseSummary.find((s: { subject: string }) => s.subject === "Science");
    expect(mathSubject.totalAssigned).toBe(1);
    expect(scienceSubject.totalAssigned).toBe(1);
  });
});
