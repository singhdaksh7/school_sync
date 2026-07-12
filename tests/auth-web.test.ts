import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked prisma (same pattern as tests/tenant-access.test.ts).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
  },
}));

// Route the "which school does this hostname belong to" tenant check
// per-test via mockResolvedValue; defaults to "no hostname context" so tests
// that don't care about cross-tenant behavior aren't forced to set it up.
vi.mock("@/lib/school-resolver", () => ({
  hostnameFromHeaders: vi.fn(() => null),
  resolveSchool: vi.fn(async () => null),
}));

vi.mock("@/lib/school-access", () => ({
  statusIsBlocked: vi.fn((status: string) => status === "SUSPENDED" || status === "EXPIRED"),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/request-ip", () => ({
  getClientIpFromHeaders: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 7, retryAfterSeconds: 0 })),
  RATE_LIMIT_POLICIES: { login: { limit: 8, windowMs: 900000 } },
}));

vi.mock("@/lib/auth-login-flow", () => ({
  authBucketKey: vi.fn((schoolId: string, flow: string, id: string) => `${schoolId}:${flow}:${id}`),
  guardAgainstLock: vi.fn(async () => ({ locked: false })),
  recordFailedCredential: vi.fn(async () => ({ locked: false })),
  completeSuccessfulWebLogin: vi.fn(async () => ({ ok: true })),
}));

// STAFF_ROLES comes from src/lib/auth-roles.ts, which is deliberately
// dependency-free (no auth/db imports) — no mock needed, the real module is
// safe to load directly in a unit test.

vi.mock("@/lib/clock", () => ({
  systemClock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
}));

// Test fixtures store the "password" field in plaintext and this mock treats
// it as already-equal-or-not, standing in for a real bcrypt hash/compare —
// none of the behavior under test depends on bcrypt's actual algorithm.
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(async (plain: string, stored: string) => plain === stored) },
}));

import { prisma } from "@/lib/prisma";
import { resolveSchool } from "@/lib/school-resolver";
import { rateLimit } from "@/lib/rate-limit";
import { authenticateStaffForWeb, authenticateFounderForWeb } from "@/lib/auth-web";
import { NoAccountError, InvalidPasswordError, RateLimitedError } from "@/lib/auth-errors";

const p = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
};
const mockResolveSchool = resolveSchool as unknown as ReturnType<typeof vi.fn>;
const mockRateLimit = rateLimit as unknown as ReturnType<typeof vi.fn>;

function fakeHeaders() {
  return new Headers();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSchool.mockResolvedValue(null);
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 7, retryAfterSeconds: 0 });
});

describe("authenticateStaffForWeb — role never trusted from the client, resolved from the DB", () => {
  it("logs in a SCHOOL_OWNER with correct credentials", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Owner One",
      email: "owner@school.edu",
      password: "correct-password",
      role: "SCHOOL_OWNER",
      ownedSchool: { id: "s1", slug: "school-one", status: "ACTIVE" },
      school: null,
    });

    const result = await authenticateStaffForWeb("owner@school.edu", "correct-password", fakeHeaders());
    expect(result).toMatchObject({ role: "SCHOOL_OWNER", schoolId: "s1", schoolSlug: "school-one" });
  });

  it("logs in an active TEACHER and resolves teacherId from the Teacher profile", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "u2",
      name: "Teacher One",
      email: "teacher@school.edu",
      password: "correct-password",
      role: "TEACHER",
      ownedSchool: null,
      school: null,
    });
    p.teacher.findFirst.mockResolvedValue({
      id: "t1",
      schoolId: "s1",
      mentorSectionId: null,
      school: { id: "s1", slug: "school-one", status: "ACTIVE" },
    });

    const result = await authenticateStaffForWeb("teacher@school.edu", "correct-password", fakeHeaders());
    expect(result).toMatchObject({ role: "TEACHER", teacherId: "t1", schoolId: "s1" });
  });

  it("rejects an unknown email as NoAccountError", async () => {
    p.user.findUnique.mockResolvedValue(null);
    await expect(authenticateStaffForWeb("nobody@school.edu", "whatever", fakeHeaders())).rejects.toThrow(NoAccountError);
  });

  it("rejects a wrong password as InvalidPasswordError", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Owner One",
      email: "owner@school.edu",
      password: "correct-password",
      role: "SCHOOL_OWNER",
      ownedSchool: { id: "s1", slug: "school-one", status: "ACTIVE" },
      school: null,
    });
    await expect(authenticateStaffForWeb("owner@school.edu", "wrong-password", fakeHeaders())).rejects.toThrow(InvalidPasswordError);
  });

  it("rejects a valid FOUNDER credential as the generic NoAccountError, not a distinct error", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "f1",
      name: "Founder",
      email: "founder@schoolsync.com",
      password: "correct-password",
      role: "FOUNDER",
      ownedSchool: null,
      school: null,
    });
    await expect(authenticateStaffForWeb("founder@schoolsync.com", "correct-password", fakeHeaders())).rejects.toThrow(NoAccountError);
  });

  it("rejects a soft-deleted / inactive teacher (no active Teacher profile) by returning null", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "u2",
      name: "Teacher One",
      email: "teacher@school.edu",
      password: "correct-password",
      role: "TEACHER",
      ownedSchool: null,
      school: null,
    });
    p.teacher.findFirst.mockResolvedValue(null);

    const result = await authenticateStaffForWeb("teacher@school.edu", "correct-password", fakeHeaders());
    expect(result).toBeNull();
  });

  it("rejects a teacher whose school does not match the resolved (hostname) tenant — cross-school access blocked", async () => {
    mockResolveSchool.mockResolvedValue({ id: "other-school" });
    p.user.findUnique.mockResolvedValue({
      id: "u2",
      name: "Teacher One",
      email: "teacher@school.edu",
      password: "correct-password",
      role: "TEACHER",
      ownedSchool: null,
      school: null,
    });
    p.teacher.findFirst.mockResolvedValue({
      id: "t1",
      schoolId: "s1", // belongs to a DIFFERENT school than the resolved tenant
      mentorSectionId: null,
      school: { id: "s1", slug: "school-one", status: "ACTIVE" },
    });

    const result = await authenticateStaffForWeb("teacher@school.edu", "correct-password", fakeHeaders());
    expect(result).toBeNull();
  });

  it("rejects an owner whose school is suspended", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Owner One",
      email: "owner@school.edu",
      password: "correct-password",
      role: "SCHOOL_OWNER",
      ownedSchool: { id: "s1", slug: "school-one", status: "SUSPENDED" },
      school: null,
    });
    const result = await authenticateStaffForWeb("owner@school.edu", "correct-password", fakeHeaders());
    expect(result).toBeNull();
  });

  it("propagates the rate limiter's rejection as RateLimitedError", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    await expect(authenticateStaffForWeb("owner@school.edu", "correct-password", fakeHeaders())).rejects.toThrow(RateLimitedError);
  });
});

describe("authenticateFounderForWeb — only a FOUNDER-role account can ever succeed", () => {
  it("logs in a FOUNDER with correct credentials", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "f1",
      name: "Founder",
      email: "founder@schoolsync.com",
      password: "correct-password",
      role: "FOUNDER",
    });
    const result = await authenticateFounderForWeb("founder@schoolsync.com", "correct-password", fakeHeaders());
    expect(result).toMatchObject({ role: "FOUNDER", schoolId: null, schoolSlug: null });
  });

  it("rejects a fully valid SCHOOL_OWNER credential as the generic NoAccountError — normal school users cannot use founder login", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "u1",
      name: "Owner One",
      email: "owner@school.edu",
      password: "correct-password",
      role: "SCHOOL_OWNER",
    });
    await expect(authenticateFounderForWeb("owner@school.edu", "correct-password", fakeHeaders())).rejects.toThrow(NoAccountError);
  });

  it("rejects a fully valid TEACHER credential the same way", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "u2",
      name: "Teacher One",
      email: "teacher@school.edu",
      password: "correct-password",
      role: "TEACHER",
    });
    await expect(authenticateFounderForWeb("teacher@school.edu", "correct-password", fakeHeaders())).rejects.toThrow(NoAccountError);
  });

  it("rejects an unknown email as NoAccountError", async () => {
    p.user.findUnique.mockResolvedValue(null);
    await expect(authenticateFounderForWeb("nobody@schoolsync.com", "whatever", fakeHeaders())).rejects.toThrow(NoAccountError);
  });

  it("rejects a wrong password for a real Founder account as InvalidPasswordError", async () => {
    p.user.findUnique.mockResolvedValue({
      id: "f1",
      name: "Founder",
      email: "founder@schoolsync.com",
      password: "correct-password",
      role: "FOUNDER",
    });
    await expect(authenticateFounderForWeb("founder@schoolsync.com", "wrong-password", fakeHeaders())).rejects.toThrow(InvalidPasswordError);
  });

  it("propagates the rate limiter's rejection as RateLimitedError", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    await expect(authenticateFounderForWeb("founder@schoolsync.com", "correct-password", fakeHeaders())).rejects.toThrow(RateLimitedError);
  });
});
