import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { issuedCertificate: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 }) };
});

import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { GET } from "@/app/api/certificates/verify/[token]/route";

const p = prisma as unknown as { issuedCertificate: { findUnique: ReturnType<typeof vi.fn> } };

function makeRequest(token: string) {
  return new Request(`http://localhost/api/certificates/verify/${token}`) as never;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/certificates/verify/[token]", () => {
  it("returns a generic not-verifiable result for an unknown token — same shape as any invalid token", async () => {
    p.issuedCertificate.findUnique.mockResolvedValue(null);
    const res = await GET(makeRequest("nonexistent-token-abcdefgh"), { params: Promise.resolve({ token: "nonexistent-token-abcdefgh" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.status).toBe("NOT_VERIFIABLE");
    expect(body).not.toHaveProperty("certificateNumber");
  });

  it("returns a short/garbage token as not-verifiable without ever querying the database (defense in depth)", async () => {
    const res = await GET(makeRequest("short"), { params: Promise.resolve({ token: "short" }) });
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(p.issuedCertificate.findUnique).not.toHaveBeenCalled();
  });

  it("returns minimal VALID details for a known, non-revoked token", async () => {
    p.issuedCertificate.findUnique.mockResolvedValue({
      certificateNumber: "BON-2026-000123",
      certificateType: "BONAFIDE",
      issueDate: new Date("2026-07-01"),
      revokedAt: null,
      school: { name: "Sample School" },
      student: { name: "Aarav Sharma" },
    });
    const res = await GET(makeRequest("a-valid-looking-token-1234"), { params: Promise.resolve({ token: "a-valid-looking-token-1234" }) });
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.status).toBe("VALID");
    expect(body.studentName).toBe("Aarav S.");
  });

  it("enforces rate limiting before any DB lookup", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const res = await GET(makeRequest("some-token-1234567890"), { params: Promise.resolve({ token: "some-token-1234567890" }) });
    expect(res.status).toBe(429);
    expect(p.issuedCertificate.findUnique).not.toHaveBeenCalled();
  });
});
