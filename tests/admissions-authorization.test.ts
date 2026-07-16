import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
    admissionReviewEvent: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  requireAdmissionRead,
  requireAdmissionConfigWrite,
  requireAdmissionReviewWrite,
  requireAdmissionEnrollmentWrite,
  requireAssignedEvaluator,
} from "@/lib/admissions/authorization";

const p = prisma as unknown as {
  school: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
  admissionReviewEvent: { findFirst: ReturnType<typeof vi.fn> };
};

function setupSchool(status = "ACTIVE") {
  p.school.findUnique.mockResolvedValue({ ownerId: "owner-x", status });
}

beforeEach(() => vi.clearAllMocks());

describe("requireAdmissionRead", () => {
  it("allows SCHOOL_OWNER/SCHOOL_ADMIN/VICE_PRINCIPAL", async () => {
    setupSchool();
    for (const role of ["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"]) {
      p.user.findUnique.mockResolvedValue({ role, schoolId: "s1" });
      const result = await requireAdmissionRead("s1", "u1");
      expect(result.ok).toBe(true);
    }
  });

  it("returns 404 (not 403) for a TEACHER — no general admissions access", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    const result = await requireAdmissionRead("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("returns 404 for STUDENT", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "STUDENT", schoolId: "s1" });
    const result = await requireAdmissionRead("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("returns 404 for a cross-school user (never 403 — no existence leak)", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_ADMIN", schoolId: "other-school" });
    const result = await requireAdmissionRead("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("blocks a SUSPENDED school for every role", async () => {
    setupSchool("SUSPENDED");
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_OWNER", schoolId: "s1" });
    const result = await requireAdmissionRead("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("requireAdmissionConfigWrite — OWNER/ADMIN only", () => {
  it("allows SCHOOL_OWNER and SCHOOL_ADMIN", async () => {
    setupSchool();
    for (const role of ["SCHOOL_OWNER", "SCHOOL_ADMIN"]) {
      p.user.findUnique.mockResolvedValue({ role, schoolId: "s1" });
      expect((await requireAdmissionConfigWrite("s1", "u1")).ok).toBe(true);
    }
  });

  it("denies VICE_PRINCIPAL (config writes stay read-only for VP, matching the repo's existing policy)", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "VICE_PRINCIPAL", schoolId: "s1" });
    const result = await requireAdmissionConfigWrite("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("requireAdmissionReviewWrite — OWNER/ADMIN/VP", () => {
  it("allows VICE_PRINCIPAL for review-workflow writes", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "VICE_PRINCIPAL", schoolId: "s1" });
    expect((await requireAdmissionReviewWrite("s1", "u1")).ok).toBe(true);
  });

  it("denies TEACHER general review writes", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    const result = await requireAdmissionReviewWrite("s1", "u1");
    expect(result.ok).toBe(false);
  });
});

describe("requireAdmissionEnrollmentWrite — OWNER/ADMIN only, never VP", () => {
  it("denies VICE_PRINCIPAL the enrollment action", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "VICE_PRINCIPAL", schoolId: "s1" });
    const result = await requireAdmissionEnrollmentWrite("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows SCHOOL_ADMIN", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_ADMIN", schoolId: "s1" });
    expect((await requireAdmissionEnrollmentWrite("s1", "u1")).ok).toBe(true);
  });
});

describe("requireAssignedEvaluator — TEACHER scoped to their own assigned review event only", () => {
  it("allows a teacher who IS the assigned evaluator on that exact event", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    p.admissionReviewEvent.findFirst.mockResolvedValue({ applicationId: "app1" });
    const result = await requireAssignedEvaluator("s1", "u1", "event1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.applicationId).toBe("app1");
  });

  it("returns 404 for a teacher who is NOT the assigned evaluator on that event", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    p.admissionReviewEvent.findFirst.mockResolvedValue(null); // query is scoped to evaluatorTeacherId: t1
    const result = await requireAssignedEvaluator("s1", "u1", "event-not-mine");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("denies a non-teacher role via this narrow path (they should use the staff path instead)", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_ADMIN", schoolId: "s1" });
    const result = await requireAssignedEvaluator("s1", "u1", "event1");
    expect(result.ok).toBe(false);
  });
});
