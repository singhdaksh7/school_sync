import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeDomainInput } from "@/lib/domain-normalize";

describe("domain normalization — hostname-only validation", () => {
  it("lowercases the hostname", () => {
    expect(normalizeDomainInput("ERP.School.COM")).toEqual({ ok: true, hostname: "erp.school.com" });
  });

  it("strips a trailing dot", () => {
    expect(normalizeDomainInput("erp.school.com.")).toEqual({ ok: true, hostname: "erp.school.com" });
  });

  it("accepts and strips an https:// prefix", () => {
    expect(normalizeDomainInput("https://erp.school.com")).toEqual({ ok: true, hostname: "erp.school.com" });
  });

  it("rejects a non-http(s) protocol", () => {
    expect(normalizeDomainInput("ftp://erp.school.com").ok).toBe(false);
  });

  it("rejects a URL with a path", () => {
    expect(normalizeDomainInput("erp.school.com/login").ok).toBe(false);
    expect(normalizeDomainInput("https://erp.school.com/some/path").ok).toBe(false);
  });

  it("rejects an explicit port", () => {
    expect(normalizeDomainInput("erp.school.com:8080").ok).toBe(false);
  });

  it("rejects credentials embedded in the input", () => {
    expect(normalizeDomainInput("user:pass@erp.school.com").ok).toBe(false);
  });

  it("rejects a malformed domain (bad label characters)", () => {
    expect(normalizeDomainInput("erp_school!.com").ok).toBe(false);
    expect(normalizeDomainInput("-erp.school.com").ok).toBe(false);
  });

  it("rejects a raw IPv4 address", () => {
    expect(normalizeDomainInput("192.168.1.1").ok).toBe(false);
  });

  it("rejects a raw IPv6 address", () => {
    expect(normalizeDomainInput("::1").ok).toBe(false);
    expect(normalizeDomainInput("[::1]").ok).toBe(false);
  });

  it("rejects localhost in any form", () => {
    expect(normalizeDomainInput("localhost").ok).toBe(false);
    expect(normalizeDomainInput("127.0.0.1").ok).toBe(false);
  });

  it("rejects a wildcard domain", () => {
    expect(normalizeDomainInput("*.school.com").ok).toBe(false);
  });

  it("rejects an overly long hostname", () => {
    const long = "a".repeat(64) + "." + "b".repeat(64) + "." + "c".repeat(64) + "." + "d".repeat(64) + ".com";
    expect(normalizeDomainInput(long).ok).toBe(false);
  });

  it("rejects a single-label input (no dot)", () => {
    expect(normalizeDomainInput("erp").ok).toBe(false);
  });

  it("rejects empty/whitespace input", () => {
    expect(normalizeDomainInput("").ok).toBe(false);
    expect(normalizeDomainInput("   ").ok).toBe(false);
    expect(normalizeDomainInput(null).ok).toBe(false);
  });

  it("rejects embedded whitespace", () => {
    expect(normalizeDomainInput("erp .school.com").ok).toBe(false);
  });

  it("converts an IDN domain to punycode (ASCII)", () => {
    const result = normalizeDomainInput("münchen.de");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hostname).toMatch(/^xn--/);
  });

  it("accepts a normal subdomain", () => {
    expect(normalizeDomainInput("erp.greenvalley.school.com")).toEqual({ ok: true, hostname: "erp.greenvalley.school.com" });
  });
});

// ── Stateful in-memory prisma.customDomain mock ──────────────────────────────
type FakeRow = {
  id: string;
  schoolId: string;
  hostname: string;
  normalizedHostname: string;
  status: string;
  verificationMethod: string;
  verificationToken: string;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let rows: FakeRow[] = [];
let idCounter = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customDomain: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          rows.find((r) => {
            if (where.schoolId && r.schoolId !== where.schoolId) return false;
            if (where.normalizedHostname && r.normalizedHostname !== where.normalizedHostname) return false;
            if (where.id && r.id !== where.id) return false;
            if (where.status && typeof where.status === "object" && "in" in (where.status as object)) {
              const list = (where.status as { in: string[] }).in;
              if (!list.includes(r.status)) return false;
            } else if (where.status && r.status !== where.status) return false;
            return true;
          }) ?? null
        );
      }),
      findUnique: vi.fn(async ({ where }: { where: { normalizedHostname?: string } }) => {
        return rows.find((r) => r.normalizedHostname === where.normalizedHostname) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeRow> }) => {
        if (rows.some((r) => r.normalizedHostname === data.normalizedHostname)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row: FakeRow = {
          id: `domain-${++idCounter}`,
          schoolId: data.schoolId!,
          hostname: data.hostname!,
          normalizedHostname: data.normalizedHostname!,
          status: data.status ?? "PENDING",
          verificationMethod: data.verificationMethod ?? "DNS_TXT",
          verificationToken: data.verificationToken!,
          lastCheckedAt: null,
          verifiedAt: null,
          failureReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeRow> }) => {
        let count = 0;
        for (const row of rows) {
          if (row.id !== where.id || row.schoolId !== where.schoolId) continue;
          if (where.status && typeof where.status === "object" && "not" in (where.status as object)) {
            if (row.status === (where.status as { not: string }).not) continue;
          }
          Object.assign(row, data);
          count++;
        }
        return { count };
      }),
    },
  },
}));

const dnsMock = vi.hoisted(() => ({ resolveTxt: vi.fn() }));
vi.mock("node:dns/promises", () => dnsMock);

beforeEach(() => {
  rows = [];
  idCounter = 0;
  dnsMock.resolveTxt.mockReset();
});

describe("custom domain — duplicate protection", () => {
  it("creates a PENDING domain request with a secure token", async () => {
    const { createDomainRequest } = await import("@/lib/custom-domain");
    const result = await createDomainRequest("school-a", "erp.school-a.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.domain.status).toBe("PENDING");
      expect(result.domain.verificationToken).toMatch(/^[0-9a-f]{48}$/); // 24 bytes hex
    }
  });

  it("refuses a second active domain request for the same school", async () => {
    const { createDomainRequest } = await import("@/lib/custom-domain");
    await createDomainRequest("school-a", "erp.school-a.com");
    const second = await createDomainRequest("school-a", "other.school-a.com");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it("refuses a normalized hostname already claimed by a DIFFERENT school", async () => {
    const { createDomainRequest } = await import("@/lib/custom-domain");
    await createDomainRequest("school-a", "erp.shared.com");
    const bySchoolB = await createDomainRequest("school-b", "erp.shared.com");
    expect(bySchoolB.ok).toBe(false);
    if (!bySchoolB.ok) expect(bySchoolB.status).toBe(409);
  });

  it("rejects an invalid hostname before touching the database", async () => {
    const { createDomainRequest } = await import("@/lib/custom-domain");
    const result = await createDomainRequest("school-a", "not a domain");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("custom domain — DNS TXT ownership verification (mocked DNS, no live lookups)", () => {
  it("marks the domain VERIFIED when the TXT record matches the token", async () => {
    const { createDomainRequest, verifyDomainRequest } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");

    dnsMock.resolveTxt.mockResolvedValue([[`schoolsync-verification=${created.domain.verificationToken}`]]);

    const result = await verifyDomainRequest("school-a", created.domain.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
      expect(result.domain.status).toBe("VERIFIED");
      expect(result.domain.verifiedAt).not.toBeNull();
    }
  });

  it("marks the domain FAILED when the TXT record value does not match", async () => {
    const { createDomainRequest, verifyDomainRequest } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");

    dnsMock.resolveTxt.mockResolvedValue([["schoolsync-verification=wrong-token"]]);

    const result = await verifyDomainRequest("school-a", created.domain.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(false);
      expect(result.domain.status).toBe("FAILED");
      expect(result.domain.failureReason).toBeTruthy();
    }
  });

  it("marks the domain FAILED (never throws) when DNS lookup fails/no record exists", async () => {
    const { createDomainRequest, verifyDomainRequest } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");

    dnsMock.resolveTxt.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));

    const result = await verifyDomainRequest("school-a", created.domain.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(false);
      expect(result.domain.status).toBe("FAILED");
    }
  });

  it("a School A actor cannot verify/mutate School B's domain request", async () => {
    const { createDomainRequest, verifyDomainRequest } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");

    const result = await verifyDomainRequest("school-b", created.domain.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("custom domain — disable/remove", () => {
  it("disables an active domain and preserves history (row still exists)", async () => {
    const { createDomainRequest, disableDomain, getDomainForSchool } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");

    const disabled = await disableDomain("school-a", created.domain.id);
    expect(disabled).toBe(true);

    const current = await getDomainForSchool("school-a");
    expect(current?.status).toBe("DISABLED");
  });

  it("allows a new domain request after the old one is disabled", async () => {
    const { createDomainRequest, disableDomain } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");
    await disableDomain("school-a", created.domain.id);

    const second = await createDomainRequest("school-a", "new-erp.school-a.com");
    expect(second.ok).toBe(true);
  });
});

describe("custom domain — verified host resolution only", () => {
  it("does not resolve a PENDING domain to any school", async () => {
    const { createDomainRequest, findVerifiedSchoolIdByHostname } = await import("@/lib/custom-domain");
    await createDomainRequest("school-a", "erp.school-a.com");
    const resolved = await findVerifiedSchoolIdByHostname("erp.school-a.com");
    expect(resolved).toBeNull();
  });

  it("does not resolve a FAILED domain to any school", async () => {
    const { createDomainRequest, verifyDomainRequest, findVerifiedSchoolIdByHostname } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");
    dnsMock.resolveTxt.mockResolvedValue([["schoolsync-verification=wrong"]]);
    await verifyDomainRequest("school-a", created.domain.id);

    expect(await findVerifiedSchoolIdByHostname("erp.school-a.com")).toBeNull();
  });

  it("does not resolve a DISABLED domain to any school, even if it was previously verified", async () => {
    const { createDomainRequest, verifyDomainRequest, disableDomain, findVerifiedSchoolIdByHostname } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");
    dnsMock.resolveTxt.mockResolvedValue([[`schoolsync-verification=${created.domain.verificationToken}`]]);
    await verifyDomainRequest("school-a", created.domain.id);
    await disableDomain("school-a", created.domain.id);

    expect(await findVerifiedSchoolIdByHostname("erp.school-a.com")).toBeNull();
  });

  it("resolves a VERIFIED domain to its owning school", async () => {
    const { createDomainRequest, verifyDomainRequest, findVerifiedSchoolIdByHostname } = await import("@/lib/custom-domain");
    const created = await createDomainRequest("school-a", "erp.school-a.com");
    if (!created.ok) throw new Error("setup failed");
    dnsMock.resolveTxt.mockResolvedValue([[`schoolsync-verification=${created.domain.verificationToken}`]]);
    await verifyDomainRequest("school-a", created.domain.id);

    const resolved = await findVerifiedSchoolIdByHostname("erp.school-a.com");
    expect(resolved?.schoolId).toBe("school-a");
  });
});
