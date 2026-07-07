import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportCard: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    examScheme: { findMany: vi.fn() },
    teacher: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null), isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/jobs", () => ({
  createJob: vi.fn(),
  REPORT_CARD_SYNC_LIMIT: 5,
  isJobWorkerConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/job-dedup", () => ({ findExistingEquivalentJob: vi.fn(async () => ({ fingerprint: "fp", existing: null })) }));
vi.mock("@/lib/report-cards", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/report-cards");
  return {
    ...actual,
    getTeacherForSession: vi.fn(),
    buildReportCardBatchContext: vi.fn(),
    generateReportCardForStudent: vi.fn(),
  };
});
vi.mock("@/lib/report-card-pdf", () => ({ generateReportCardPdf: vi.fn(async () => Buffer.from("pdf")) }));

import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { createJob, isJobWorkerConfigured } from "@/lib/jobs";
import { findExistingEquivalentJob } from "@/lib/job-dedup";
import { buildReportCardBatchContext, generateReportCardForStudent, getTeacherForSession } from "@/lib/report-cards";
import { prisma } from "@/lib/prisma";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;
const createJobMock = createJob as unknown as ReturnType<typeof vi.fn>;
const isJobWorkerConfiguredMock = isJobWorkerConfigured as unknown as ReturnType<typeof vi.fn>;
const dedupMock = findExistingEquivalentJob as unknown as ReturnType<typeof vi.fn>;
const buildCtxMock = buildReportCardBatchContext as unknown as ReturnType<typeof vi.fn>;
const generateCardMock = generateReportCardForStudent as unknown as ReturnType<typeof vi.fn>;
const getTeacherForSessionMock = getTeacherForSession as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as {
  reportCard: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  examScheme: { findMany: ReturnType<typeof vi.fn> };
  teacher: { findUnique: ReturnType<typeof vi.fn> };
};

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const MENTOR = {
  id: "teacher-1",
  schoolId: "school-a",
  mentorSectionId: "sec-1",
  mentorSection: { students: [{ id: "stu-1" }, { id: "stu-2" }] },
};

function jsonReq(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  getTeacherForSessionMock.mockResolvedValue(MENTOR);
  p.teacher.findUnique.mockResolvedValue(MENTOR);
  teacherPermMock.mockResolvedValue(null);
  p.reportCard.findMany.mockResolvedValue([]);
  p.examScheme.findMany.mockResolvedValue([]);
  isJobWorkerConfiguredMock.mockReturnValue(true);
  dedupMock.mockResolvedValue({ fingerprint: "fp", existing: null });
});

describe("Report cards — list matches web authorization", () => {
  it("REPORT_CARDS:VIEW permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { GET } = await import("@/app/api/teacher/report-cards/route");
    const res = await GET(new Request("http://localhost/api/teacher/report-cards"));
    expect(res.status).toBe(403);
  });

  it("no mentor section returns an empty, well-formed response (not an error)", async () => {
    getTeacherForSessionMock.mockResolvedValue({ ...MENTOR, mentorSectionId: null, mentorSection: null });
    const { GET } = await import("@/app/api/teacher/report-cards/route");
    const res = await GET(new Request("http://localhost/api/teacher/report-cards"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reportCards: [], mentorSection: null, schemes: [] });
  });
});

describe("Report cards — generation sync mode preserved", () => {
  it("small batches generate synchronously (no job created)", async () => {
    buildCtxMock.mockResolvedValue({ scheme: {} });
    generateCardMock.mockResolvedValue({ id: "card-1" });
    const { POST } = await import("@/app/api/teacher/report-cards/generate/route");
    const res = await POST(jsonReq("http://localhost/x", { examSchemeId: "scheme-1" }));
    expect(res.status).toBe(200);
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it("students outside the mentor section are rejected", async () => {
    const { POST } = await import("@/app/api/teacher/report-cards/generate/route");
    const res = await POST(jsonReq("http://localhost/x", { examSchemeId: "scheme-1", studentIds: ["not-in-section"] }));
    expect(res.status).toBe(403);
  });
});

describe("Report cards — job mode + dedup preserved", () => {
  it("a batch above the sync limit enqueues a job (202)", async () => {
    const manyStudents = Array.from({ length: 10 }, (_, i) => ({ id: `stu-${i}` }));
    getTeacherForSessionMock.mockResolvedValue({ ...MENTOR, mentorSection: { students: manyStudents } });
    createJobMock.mockResolvedValue({ ok: true, job: { id: "job-1", status: "PENDING", totalItems: 10 }, deduplicated: false });

    const { POST } = await import("@/app/api/teacher/report-cards/generate/route");
    const res = await POST(jsonReq("http://localhost/x", { examSchemeId: "scheme-1" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.mode).toBe("job");
  });

  it("an existing equivalent active job is returned instead of creating a duplicate", async () => {
    const manyStudents = Array.from({ length: 10 }, (_, i) => ({ id: `stu-${i}` }));
    getTeacherForSessionMock.mockResolvedValue({ ...MENTOR, mentorSection: { students: manyStudents } });
    dedupMock.mockResolvedValue({ fingerprint: "fp", existing: { id: "job-existing", status: "RUNNING", totalItems: 10 } });

    const { POST } = await import("@/app/api/teacher/report-cards/generate/route");
    const res = await POST(jsonReq("http://localhost/x", { examSchemeId: "scheme-1" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.deduplicated).toBe(true);
    expect(body.jobId).toBe("job-existing");
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it("refuses to enqueue when no job worker is configured", async () => {
    const manyStudents = Array.from({ length: 10 }, (_, i) => ({ id: `stu-${i}` }));
    getTeacherForSessionMock.mockResolvedValue({ ...MENTOR, mentorSection: { students: manyStudents } });
    isJobWorkerConfiguredMock.mockReturnValue(false);

    const { POST } = await import("@/app/api/teacher/report-cards/generate/route");
    const res = await POST(jsonReq("http://localhost/x", { examSchemeId: "scheme-1" }));
    expect(res.status).toBe(503);
  });
});

describe("Report cards — publish authorization preserved", () => {
  it("REPORT_CARDS:PUBLISH permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { POST } = await import("@/app/api/teacher/report-cards/[id]/publish/route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(403);
  });

  it("a report card outside the teacher's mentor section is not found", async () => {
    p.reportCard.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/teacher/report-cards/[id]/publish/route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(404);
  });
});

describe("Report cards — PDF authorization and Cost Guard preserved", () => {
  it("PDF Cost Guard denial (429) is preserved", async () => {
    const rateMock = (await import("@/lib/api-cost-guard")).enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;
    rateMock.mockResolvedValueOnce(NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 }));
    const { GET } = await import("@/app/api/teacher/report-cards/[id]/pdf/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(429);
  });

  it("REPORT_CARDS:DOWNLOAD permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { GET } = await import("@/app/api/teacher/report-cards/[id]/pdf/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "card-1" }) });
    expect(res.status).toBe(403);
  });
});
