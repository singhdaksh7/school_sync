import { describe, it, expect, vi, beforeEach } from "vitest";

// Same mock set as tests/auth-web.test.ts (staffAuthorize/founderAuthorize
// delegate to authenticateStaffForWeb/authenticateFounderForWeb, which need
// these), plus next/headers since staffAuthorize/founderAuthorize call
// requestHeaders() -> headers() directly instead of taking it as an argument
// (mirrors the pre-existing "credentials" provider's own behavior).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
    school: { findUnique: vi.fn() },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

// The real "next-auth" package's index pulls in lib/env.js, which imports
// next/server — that only resolves inside a real Next.js build/dev process,
// not a plain Node/Vitest run (this is a pre-existing quirk of the next-auth
// package, unrelated to this refactor; it's why no other test in this repo
// imports src/lib/auth.ts directly either — they all mock it). CredentialsSignin
// is a minimal error subclass; this stand-in preserves `instanceof` checks
// against the errors src/lib/auth-providers.ts throws, since both this test
// file and auth-providers.ts resolve "next-auth" to this same mock.
vi.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
}));

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
  RATE_LIMIT_POLICIES: { login: { limit: 8, windowMs: 900000 }, studentLogin: { limit: 10, windowMs: 900000 } },
}));

vi.mock("@/lib/auth-login-flow", () => ({
  authBucketKey: vi.fn((schoolId: string, flow: string, id: string) => `${schoolId}:${flow}:${id}`),
  guardAgainstLock: vi.fn(async () => ({ locked: false })),
  recordFailedCredential: vi.fn(async () => ({ locked: false })),
  completeSuccessfulWebLogin: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/mobile-auth", () => ({
  // studentAuthorize imports authenticateStudentForMobile — not exercised by
  // this suite (Founder/staff separation is the focus here; student login is
  // covered by tests/student-login.test.ts and tests/auth-web.test.ts), so a
  // stub that always signals "no account" is enough to keep the module
  // loadable without pulling in the real mobile-auth.ts -> auth.ts cycle.
  authenticateStudentForMobile: vi.fn(async () => {
    throw new Error("not exercised in this suite");
  }),
}));

vi.mock("@/lib/clock", () => ({
  systemClock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(async (plain: string, stored: string) => plain === stored) },
}));

import { prisma } from "@/lib/prisma";
import { staffAuthorize, founderAuthorize, NoAccountError } from "@/lib/auth-providers";
import { CredentialsSignin } from "next-auth";

const p = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
};

const FOUNDER_ROW = {
  id: "f1",
  name: "Founder",
  email: "founder@schoolsync.com",
  password: "correct-password",
  role: "FOUNDER",
  ownedSchool: null,
  school: null,
};
const OWNER_ROW = {
  id: "u1",
  name: "Owner One",
  email: "owner@school.edu",
  password: "correct-password",
  role: "SCHOOL_OWNER",
  ownedSchool: { id: "s1", slug: "school-one", status: "ACTIVE" },
  school: null,
};
const TEACHER_ROW = {
  id: "u2",
  name: "Teacher One",
  email: "teacher@school.edu",
  password: "correct-password",
  role: "TEACHER",
  ownedSchool: null,
  school: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staffAuthorize (the actual 'credentials' provider used by /login) — Founder rejected at the provider boundary", () => {
  it("rejects a valid Founder credential passed directly to the provider, as a CredentialsSignin (NextAuth's own 'no session' signal)", async () => {
    p.user.findUnique.mockResolvedValue(FOUNDER_ROW);
    await expect(staffAuthorize({ email: "founder@schoolsync.com", password: "correct-password" })).rejects.toBeInstanceOf(CredentialsSignin);
  });

  it("specifically throws the generic NoAccountError, not a distinct 'founder detected' error", async () => {
    p.user.findUnique.mockResolvedValue(FOUNDER_ROW);
    await expect(staffAuthorize({ email: "founder@schoolsync.com", password: "correct-password" })).rejects.toBeInstanceOf(NoAccountError);
  });

  it("still logs in a real SCHOOL_OWNER through the same provider", async () => {
    p.user.findUnique.mockResolvedValue(OWNER_ROW);
    const result = await staffAuthorize({ email: "owner@school.edu", password: "correct-password" });
    expect(result).toMatchObject({ role: "SCHOOL_OWNER" });
  });

  it("a forged role field on the submitted credentials does nothing — the returned role always comes from the database, never from the input", async () => {
    p.user.findUnique.mockResolvedValue(OWNER_ROW);
    const result = await staffAuthorize({ email: "owner@school.edu", password: "correct-password", role: "FOUNDER" });
    expect(result).toMatchObject({ role: "SCHOOL_OWNER" }); // NOT "FOUNDER", despite the forged field
  });

  it("a forged role=FOUNDER field cannot rescue a real Founder account trying this provider either — still rejected", async () => {
    p.user.findUnique.mockResolvedValue(FOUNDER_ROW);
    await expect(
      staffAuthorize({ email: "founder@schoolsync.com", password: "correct-password", role: "FOUNDER" })
    ).rejects.toBeInstanceOf(NoAccountError);
  });
});

describe("founderAuthorize (the actual 'founder-credentials' provider used by /founder/login) — only Founder ever succeeds", () => {
  it("rejects a valid school administrator credential passed directly to this provider", async () => {
    p.user.findUnique.mockResolvedValue(OWNER_ROW);
    await expect(founderAuthorize({ email: "owner@school.edu", password: "correct-password" })).rejects.toBeInstanceOf(NoAccountError);
  });

  it("rejects a valid teacher credential passed directly to this provider", async () => {
    p.user.findUnique.mockResolvedValue(TEACHER_ROW);
    await expect(founderAuthorize({ email: "teacher@school.edu", password: "correct-password" })).rejects.toBeInstanceOf(NoAccountError);
  });

  it("a forged role=FOUNDER field cannot turn a real Owner account into a Founder session", async () => {
    p.user.findUnique.mockResolvedValue(OWNER_ROW);
    await expect(
      founderAuthorize({ email: "owner@school.edu", password: "correct-password", role: "FOUNDER" })
    ).rejects.toBeInstanceOf(NoAccountError);
  });

  it("logs in a real Founder account through this provider", async () => {
    p.user.findUnique.mockResolvedValue(FOUNDER_ROW);
    const result = await founderAuthorize({ email: "founder@schoolsync.com", password: "correct-password" });
    expect(result).toMatchObject({ role: "FOUNDER" });
  });

  it("every rejection path throws (never silently returns a user object) — NextAuth issues no JWT/session/cookie when authorize() throws", async () => {
    p.user.findUnique.mockResolvedValue(OWNER_ROW);
    let threw = false;
    try {
      await founderAuthorize({ email: "owner@school.edu", password: "correct-password" });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(CredentialsSignin);
    }
    expect(threw).toBe(true);
  });
});
