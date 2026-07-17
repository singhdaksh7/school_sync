import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/teacher-permissions", () => ({
  teacherHasPermission: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { teacherHasPermission } from "@/lib/teacher-permissions";
import { requireCertificateAction, assertNoSelfReviewConflict } from "@/lib/certificates/authorization";

const p = prisma as unknown as {
  school: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
};

function setupSchool(status = "ACTIVE") {
  p.school.findUnique.mockResolvedValue({ ownerId: "owner-x", status });
}

beforeEach(() => vi.clearAllMocks());

describe("requireCertificateAction", () => {
  it("grants SCHOOL_OWNER/SCHOOL_ADMIN every action", async () => {
    setupSchool();
    for (const role of ["SCHOOL_OWNER", "SCHOOL_ADMIN"]) {
      p.user.findUnique.mockResolvedValue({ role, schoolId: "s1" });
      for (const action of ["REQUEST_VIEW", "REVIEW", "APPROVE", "REJECT", "ISSUE", "REVOKE", "TEMPLATE_MANAGE", "REPORT_VIEW"] as const) {
        const result = await requireCertificateAction("s1", "u1", action);
        expect(result.ok).toBe(true);
      }
    }
  });

  it("grants VICE_PRINCIPAL only the narrow review actions", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "VICE_PRINCIPAL", schoolId: "s1" });

    for (const action of ["REQUEST_VIEW", "REVIEW", "APPROVE", "REJECT", "REPORT_VIEW"] as const) {
      const result = await requireCertificateAction("s1", "u1", action);
      expect(result.ok).toBe(true);
    }
    for (const action of ["ISSUE", "REVOKE", "TEMPLATE_MANAGE"] as const) {
      const result = await requireCertificateAction("s1", "u1", action);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  });

  it("denies a TEACHER with no delegated permission", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    vi.mocked(teacherHasPermission).mockResolvedValue(false);

    const result = await requireCertificateAction("s1", "u1", "APPROVE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("grants a TEACHER with an explicit delegated permission", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    vi.mocked(teacherHasPermission).mockResolvedValue(true);

    const result = await requireCertificateAction("s1", "u1", "APPROVE");
    expect(result.ok).toBe(true);
    expect(teacherHasPermission).toHaveBeenCalledWith("t1", "s1", "CERTIFICATES", "APPROVE");
  });

  it("returns 404 (not 403) for a cross-school/non-member user", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_ADMIN", schoolId: "other-school" });
    const result = await requireCertificateAction("s1", "u1", "REQUEST_VIEW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("blocks access when the school is suspended", async () => {
    setupSchool("SUSPENDED");
    const result = await requireCertificateAction("s1", "u1", "REQUEST_VIEW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("assertNoSelfReviewConflict", () => {
  it("blocks a staff actor from reviewing their own on-behalf-of request", () => {
    const actor = { userId: "u1", role: "SCHOOL_ADMIN", teacherId: null };
    const request = { requesterType: "STAFF", requesterUserId: "u1" };
    const response = assertNoSelfReviewConflict(actor, request);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it("allows review when the requester is a different staff member", () => {
    const actor = { userId: "u1", role: "SCHOOL_ADMIN", teacherId: null };
    const request = { requesterType: "STAFF", requesterUserId: "u2" };
    expect(assertNoSelfReviewConflict(actor, request)).toBeNull();
  });

  it("allows review for STUDENT/GUARDIAN-initiated requests regardless of actor", () => {
    const actor = { userId: "u1", role: "SCHOOL_ADMIN", teacherId: null };
    expect(assertNoSelfReviewConflict(actor, { requesterType: "STUDENT", requesterUserId: null })).toBeNull();
    expect(assertNoSelfReviewConflict(actor, { requesterType: "GUARDIAN", requesterUserId: null })).toBeNull();
  });
});
