import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, getActiveTeacherByUserId } from "@/lib/tenant";

const p = prisma as unknown as {
  school: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
};

function setup(schoolStatus: string, userRole: string, opts: { owner?: boolean } = {}) {
  p.school.findUnique.mockResolvedValue({ ownerId: opts.owner ? "u1" : "owner-x", status: schoolStatus });
  p.user.findUnique.mockResolvedValue({ role: userRole, schoolId: "s1" });
}

beforeEach(() => vi.clearAllMocks());

describe("canAccessSchool — role-aware admin access (A1)", () => {
  it("allows the SCHOOL_OWNER", async () => {
    setup("ACTIVE", "SCHOOL_OWNER", { owner: true });
    expect(await canAccessSchool("s1", "u1")).toBe(true);
  });

  it("allows a SCHOOL_ADMIN of the school", async () => {
    setup("ACTIVE", "SCHOOL_ADMIN");
    expect(await canAccessSchool("s1", "u1")).toBe(true);
  });

  it("allows a VICE_PRINCIPAL to READ", async () => {
    setup("ACTIVE", "VICE_PRINCIPAL");
    expect(await canAccessSchool("s1", "u1")).toBe(true);
  });

  it("DENIES a TEACHER even though User.schoolId is set (escalation closed)", async () => {
    setup("ACTIVE", "TEACHER");
    expect(await canAccessSchool("s1", "u1")).toBe(false);
  });
});

describe("canWriteSchool — VP is read-only", () => {
  it("denies VICE_PRINCIPAL writes without a DB round trip", async () => {
    expect(await canWriteSchool("s1", "u1", "VICE_PRINCIPAL")).toBe(false);
    expect(p.school.findUnique).not.toHaveBeenCalled();
  });

  it("allows a SCHOOL_ADMIN write", async () => {
    setup("ACTIVE", "SCHOOL_ADMIN");
    expect(await canWriteSchool("s1", "u1", "SCHOOL_ADMIN")).toBe(true);
  });
});

describe("canAccessSchool — lifecycle enforcement (A3)", () => {
  it("allows ACTIVE and TRIAL schools", async () => {
    setup("ACTIVE", "SCHOOL_ADMIN");
    expect(await canAccessSchool("s1", "u1")).toBe(true);
    setup("TRIAL", "SCHOOL_ADMIN");
    expect(await canAccessSchool("s1", "u1")).toBe(true);
  });

  it("blocks SUSPENDED and EXPIRED schools even for an admin", async () => {
    setup("SUSPENDED", "SCHOOL_ADMIN");
    expect(await canAccessSchool("s1", "u1")).toBe(false);
    setup("EXPIRED", "SCHOOL_OWNER", { owner: true });
    expect(await canAccessSchool("s1", "u1")).toBe(false);
  });
});

describe("getActiveTeacherByUserId — soft-deleted teachers excluded (A2)", () => {
  it("queries with isDeleted:false and returns null for a deleted teacher", async () => {
    p.teacher.findFirst.mockResolvedValue(null); // deleted → no active row
    const result = await getActiveTeacherByUserId("u1");
    expect(result).toBeNull();
    expect(p.teacher.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", isDeleted: false } })
    );
  });

  it("returns the active teacher when one exists", async () => {
    p.teacher.findFirst.mockResolvedValue({ id: "t1", schoolId: "s1" });
    expect(await getActiveTeacherByUserId("u1")).toEqual({ id: "t1", schoolId: "s1" });
  });
});
