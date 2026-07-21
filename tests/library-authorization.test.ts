import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
    teacherRoleAssignment: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  requireLibraryRead,
  requireLibraryCatalogueManage,
  requireLibraryFineWaive,
  requireLibraryCapability,
} from "@/lib/library/authorization";

const p = prisma as unknown as {
  school: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
  teacherRoleAssignment: { findFirst: ReturnType<typeof vi.fn> };
};

function setupSchool(status = "ACTIVE") {
  p.school.findUnique.mockResolvedValue({ ownerId: "owner-x", status });
}

beforeEach(() => vi.clearAllMocks());

describe("requireLibraryRead — leadership roles", () => {
  it("allows SCHOOL_OWNER / SCHOOL_ADMIN / VICE_PRINCIPAL", async () => {
    for (const role of ["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"]) {
      setupSchool();
      p.user.findUnique.mockResolvedValue({ role, schoolId: "s1" });
      const result = await requireLibraryRead("s1", "u1");
      expect(result.ok).toBe(true);
    }
  });

  it("returns 404 for a STUDENT (never reaches the staff surface)", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "STUDENT", schoolId: "s1" });
    const result = await requireLibraryRead("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("returns 404 for a cross-school admin (no existence leak, never 403)", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_ADMIN", schoolId: "other-school" });
    const result = await requireLibraryRead("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("blocks a SUSPENDED school with 403 for every role", async () => {
    setupSchool("SUSPENDED");
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_OWNER", schoolId: "s1" });
    const result = await requireLibraryRead("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("teacher delegated capability enforcement", () => {
  it("allows a TEACHER holding the LIBRARY:CATALOGUE_MANAGE grant", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    p.teacherRoleAssignment.findFirst.mockResolvedValue({ id: "assign1" });
    const result = await requireLibraryCatalogueManage("s1", "u1");
    expect(result.ok).toBe(true);
  });

  it("returns 403 MISSING_PERMISSION for a same-school TEACHER without the grant", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    p.teacherRoleAssignment.findFirst.mockResolvedValue(null);
    const result = await requireLibraryFineWaive("s1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns 404 for a TEACHER whose teacher row is not in this school", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "TEACHER", schoolId: "s1" });
    p.teacher.findFirst.mockResolvedValue(null);
    const result = await requireLibraryCapability("s1", "u1", "ISSUE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("leadership bypasses the per-capability grant entirely", async () => {
    setupSchool();
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_ADMIN", schoolId: "s1" });
    const result = await requireLibraryFineWaive("s1", "u1");
    expect(result.ok).toBe(true);
    // Leadership must never consult TeacherPermission.
    expect(p.teacherRoleAssignment.findFirst).not.toHaveBeenCalled();
  });
});
