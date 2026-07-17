import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/mobile-auth", () => ({ getMobileAuth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { school: { findUnique: vi.fn() } } }));

import { auth } from "@/lib/auth";
import { getMobileAuth } from "@/lib/mobile-auth";
import { resolveLibraryStaffUser } from "@/lib/library/http";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockGetMobileAuth = getMobileAuth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("resolveLibraryStaffUser — web session vs mobile bearer equivalence", () => {
  it("resolves from a web session cookie when present", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SCHOOL_ADMIN" } });
    const result = await resolveLibraryStaffUser(new Request("http://x"));
    expect(result).toEqual({ userId: "u1", role: "SCHOOL_ADMIN" });
    expect(mockGetMobileAuth).not.toHaveBeenCalled();
  });

  it("falls back to a mobile bearer token when no session exists, resolving the same shape", async () => {
    mockAuth.mockResolvedValue(null);
    mockGetMobileAuth.mockResolvedValue({ decoded: { userId: "u2", role: "TEACHER" } });
    const result = await resolveLibraryStaffUser(new Request("http://x", { headers: { Authorization: "Bearer tok" } }));
    expect(result).toEqual({ userId: "u2", role: "TEACHER" });
  });

  it("derives userId from the mobile teacher record when the token itself carries none", async () => {
    mockAuth.mockResolvedValue(null);
    mockGetMobileAuth.mockResolvedValue({ decoded: { role: "TEACHER" }, teacher: { userId: "u3" } });
    const result = await resolveLibraryStaffUser(new Request("http://x"));
    expect(result).toEqual({ userId: "u3", role: "TEACHER" });
  });

  it("derives userId from the mobile user record as a last resort", async () => {
    mockAuth.mockResolvedValue(null);
    mockGetMobileAuth.mockResolvedValue({ decoded: { role: "SCHOOL_ADMIN" }, user: { id: "u4" } });
    const result = await resolveLibraryStaffUser(new Request("http://x"));
    expect(result).toEqual({ userId: "u4", role: "SCHOOL_ADMIN" });
  });

  it("returns null for a STUDENT bearer token (no userId anywhere) — students must use /api/student/library", async () => {
    mockAuth.mockResolvedValue(null);
    mockGetMobileAuth.mockResolvedValue({ decoded: { role: "STUDENT", studentId: "st1" } });
    const result = await resolveLibraryStaffUser(new Request("http://x"));
    expect(result).toBeNull();
  });

  it("returns null when neither a session nor a valid bearer token is present", async () => {
    mockAuth.mockResolvedValue(null);
    mockGetMobileAuth.mockResolvedValue(null);
    const result = await resolveLibraryStaffUser(new Request("http://x"));
    expect(result).toBeNull();
  });
});
