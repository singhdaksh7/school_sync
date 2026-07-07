import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Actor-isolation (bearer Student/Parent/Admin denied, cross-tenant denied,
// web-Teacher-equivalence) is a PROPERTY of getTeacherAuth itself, already
// exhaustively proven with real JWTs in tests/teacher-bearer-auth-equivalence.test.ts
// (same function, unchanged). This file focuses on the NEW logic this route
// adds: job-type restriction, ownership restriction, and safe DTO shape.
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ getJobForSchool: vi.fn() }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));

import { getTeacherAuth } from "@/lib/mobile-auth";
import { getJobForSchool } from "@/lib/jobs";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { GET } from "@/app/api/teacher/jobs/[jobId]/route";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const getJobForSchoolMock = getJobForSchool as unknown as ReturnType<typeof vi.fn>;
const rateLimitMock = enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };

function reportCardJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    schoolId: "school-a",
    type: "REPORT_CARD_BATCH_GENERATION",
    status: "RUNNING",
    payload: { teacherId: "teacher-1", schoolId: "school-a", sectionId: "sec-1" },
    totalItems: 40,
    processedItems: 10,
    failedItems: 0,
    errorSummary: null,
    claimToken: "secret-claim-token",
    payloadFingerprint: "fp-abc123",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function req(url = "http://localhost/api/teacher/jobs/job-1") {
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  rateLimitMock.mockResolvedValue(null);
});

describe("GET /api/teacher/jobs/[jobId] — ownership and type restriction", () => {
  it("a Teacher can read their own report-card generation job", async () => {
    getJobForSchoolMock.mockResolvedValue(reportCardJob());
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("job-1");
    expect(body.status).toBe("RUNNING");
    expect(body.totalItems).toBe(40);
  });

  it("denies a job belonging to a different teacher in the same school", async () => {
    getJobForSchoolMock.mockResolvedValue(reportCardJob({ payload: { teacherId: "someone-else", schoolId: "school-a" } }));
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(res.status).toBe(404);
  });

  it("denies an unrelated administrative job type (e.g. STUDENT_BULK_IMPORT) even if owned by this school", async () => {
    getJobForSchoolMock.mockResolvedValue(reportCardJob({ type: "STUDENT_BULK_IMPORT", payload: { teacherId: "teacher-1" } }));
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(res.status).toBe(404);
  });

  it("denies SMART_TIMETABLE_GENERATION and FILE_RETENTION_CLEANUP the same way", async () => {
    for (const type of ["SMART_TIMETABLE_GENERATION", "FILE_RETENTION_CLEANUP"]) {
      getJobForSchoolMock.mockResolvedValue(reportCardJob({ type, payload: { teacherId: "teacher-1" } }));
      const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
      expect(res.status).toBe(404);
    }
  });

  it("cross-tenant: a job id from another school is not found (getJobForSchool is school-scoped)", async () => {
    getJobForSchoolMock.mockResolvedValue(null); // getJobForSchool itself returns null for a schoolId mismatch
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(res.status).toBe(404);
    expect(getJobForSchoolMock).toHaveBeenCalledWith("job-1", "school-a");
  });

  it("unauthenticated request is denied", async () => {
    getTeacherAuthMock.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(res.status).toBe(401);
    expect(getJobForSchoolMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/teacher/jobs/[jobId] — safe DTO shape", () => {
  it("never includes claimToken, raw payload, or payloadFingerprint", async () => {
    getJobForSchoolMock.mockResolvedValue(reportCardJob());
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    const body = await res.json();
    expect(body).not.toHaveProperty("claimToken");
    expect(body).not.toHaveProperty("payload");
    expect(body).not.toHaveProperty("payloadFingerprint");
    expect(JSON.stringify(body)).not.toContain("secret-claim-token");
    expect(JSON.stringify(body)).not.toContain("fp-abc123");
  });

  it("includes only the documented safe progress fields", async () => {
    getJobForSchoolMock.mockResolvedValue(reportCardJob());
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["createdAt", "errorSummary", "failedItems", "id", "processedItems", "status", "totalItems", "type", "updatedAt"].sort()
    );
  });
});

describe("GET /api/teacher/jobs/[jobId] — Cost Guard", () => {
  it("preserves a JOB_STATUS rate-limit denial", async () => {
    rateLimitMock.mockResolvedValueOnce(NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 }));
    const res = await GET(req(), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(res.status).toBe(429);
    expect(getJobForSchoolMock).not.toHaveBeenCalled();
    expect(rateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-a", actorType: "TEACHER" }), "JOB_STATUS");
  });
});
