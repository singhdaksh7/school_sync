import { describe, it, expect, vi } from "vitest";
import {
  MemoryRateLimiter,
  RestRedisRateLimiter,
  isDistributedRateLimiterConfigured,
  getRateLimiterKind,
} from "@/lib/rate-limit";
import {
  MemoryStorageProvider,
  NotConfiguredStorageProvider,
  StorageError,
  generateStorageKey,
  tenantKeyPrefix,
  assertKeyInTenantNamespace,
  safeFilename,
  isStorageConfigured,
} from "@/lib/storage";
import { validateUpload, sniffContentType, UPLOAD_POLICIES } from "@/lib/upload-validation";
import { parsePagination, buildPaginationMeta, paginated, MAX_LIMIT } from "@/lib/pagination";

// ── Distributed rate limiting (E1) ───────────────────────────────────────────
describe("rate limiting — distributed adapter", () => {
  it("MemoryRateLimiter still enforces the window (dev/test default)", async () => {
    const limiter = new MemoryRateLimiter();
    const policy = { limit: 2, windowMs: 60_000 };
    expect((await limiter.check("k", policy)).allowed).toBe(true);
    expect((await limiter.check("k", policy)).allowed).toBe(true);
    const third = await limiter.check("k", policy);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("RestRedisRateLimiter allows under the limit using the pipeline count", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 1 }, { result: 1 }, { result: 59_000 }],
    });
    const limiter = new RestRedisRateLimiter("https://redis.example", "tok", fetchImpl as unknown as typeof fetch);
    const res = await limiter.check("login:1.2.3.4", { limit: 5, windowMs: 60_000 });
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(4);
    // Sends an atomic INCR + PEXPIRE NX + PTTL pipeline, namespaced.
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
    expect(body[0]).toEqual(["INCR", "ratelimit:login:1.2.3.4"]);
    expect(body[1][0]).toBe("PEXPIRE");
    expect(body[2][0]).toBe("PTTL");
  });

  it("RestRedisRateLimiter denies over the limit and reports retry-after from PTTL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 6 }, { result: 0 }, { result: 30_000 }],
    });
    const limiter = new RestRedisRateLimiter("https://redis.example", "tok", fetchImpl as unknown as typeof fetch);
    const res = await limiter.check("k", { limit: 5, windowMs: 60_000 });
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSeconds).toBe(30);
  });

  it("RestRedisRateLimiter throws (no false 'allow') on backend HTTP error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const limiter = new RestRedisRateLimiter("https://redis.example", "tok", fetchImpl as unknown as typeof fetch);
    await expect(limiter.check("k", { limit: 5, windowMs: 60_000 })).rejects.toThrow();
  });

  it("config detection reflects env and defaults to the memory kind in tests", () => {
    expect(isDistributedRateLimiterConfigured()).toBe(false);
    expect(getRateLimiterKind()).toBe("memory");
  });
});

// ── Storage abstraction + keys (A2/A6) ───────────────────────────────────────
describe("storage — tenant-safe keys and providers", () => {
  it("generates a server-controlled, tenant-namespaced key", () => {
    const key = generateStorageKey({ category: "HOMEWORK_ATTACHMENT", schoolId: "s1", originalFilename: "My Notes.pdf" });
    expect(key.startsWith(tenantKeyPrefix("HOMEWORK_ATTACHMENT", "s1"))).toBe(true);
    expect(key).toMatch(/my_notes\.pdf$/i);
  });

  it("sanitizes dangerous filenames (no traversal, no separators)", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("a b/c\\d.png")).toBe("d.png");
  });

  it("rejects cross-tenant and traversal keys", () => {
    const good = generateStorageKey({ category: "HOMEWORK_ATTACHMENT", schoolId: "s1", originalFilename: "x.pdf" });
    expect(() => assertKeyInTenantNamespace(good, "HOMEWORK_ATTACHMENT", "s1")).not.toThrow();
    // School B cannot touch School A's key.
    expect(() => assertKeyInTenantNamespace(good, "HOMEWORK_ATTACHMENT", "s2")).toThrow(StorageError);
    expect(() => assertKeyInTenantNamespace("homework_attachment/s1/../s2/x", "HOMEWORK_ATTACHMENT", "s1")).toThrow(StorageError);
  });

  it("MemoryStorageProvider round-trips and heads objects", async () => {
    const p = new MemoryStorageProvider();
    await p.putObject({ key: "k", body: Buffer.from("hi"), contentType: "text/plain", visibility: "TENANT_PRIVATE" });
    expect((await p.getObject("k"))?.body.toString()).toBe("hi");
    expect((await p.head("k"))?.size).toBe(2);
    await p.deleteObject("k");
    expect(await p.getObject("k")).toBeNull();
  });

  it("NotConfiguredStorageProvider fails safe instead of silently dropping files", async () => {
    const p = new NotConfiguredStorageProvider();
    await expect(p.putObject({ key: "k", body: Buffer.from("x"), contentType: "application/pdf", visibility: "BILLING_PRIVATE" }))
      .rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("reports storage as unconfigured without env", () => {
    expect(isStorageConfigured()).toBe(false);
  });
});

// ── Upload validation (A5) ───────────────────────────────────────────────────
describe("upload validation — per-category policies", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const svg = new Uint8Array(new TextEncoder().encode("<svg xmlns='...'></svg>"));

  it("accepts an allowed PNG branding image", () => {
    const res = validateUpload("BRANDING_IMAGE", { declaredContentType: "image/png", size: png.byteLength, bytes: png });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visibility).toBe("PUBLIC");
  });

  it("rejects SVG everywhere (active-content risk)", () => {
    const res = validateUpload("BRANDING_IMAGE", { declaredContentType: "image/svg+xml", size: svg.byteLength, bytes: svg });
    expect(res.ok).toBe(false);
  });

  it("rejects HTML/markup content even if declared as an image", () => {
    const html = new Uint8Array(new TextEncoder().encode("<html><script>alert(1)</script>"));
    const res = validateUpload("HOMEWORK_ATTACHMENT", { declaredContentType: "image/png", size: html.byteLength, bytes: html });
    expect(res.ok).toBe(false);
  });

  it("rejects a PDF for a category that only allows images", () => {
    const res = validateUpload("BRANDING_IMAGE", { declaredContentType: "application/pdf", size: pdf.byteLength, bytes: pdf });
    expect(res.ok).toBe(false);
  });

  it("rejects oversized files by category cap", () => {
    const res = validateUpload("BRANDING_IMAGE", { declaredContentType: "image/png", size: UPLOAD_POLICIES.BRANDING_IMAGE.maxBytes + 1 });
    expect(res.ok).toBe(false);
  });

  it("rejects when declared type disagrees with sniffed bytes", () => {
    const res = validateUpload("HOMEWORK_ATTACHMENT", { declaredContentType: "application/pdf", size: png.byteLength, bytes: png });
    expect(res.ok).toBe(false);
  });

  it("sniffs core binary types and flags markup", () => {
    expect(sniffContentType(png)).toBe("image/png");
    expect(sniffContentType(pdf)).toBe("application/pdf");
    expect(sniffContentType(svg)).toBe("text/markup");
  });
});

// ── Pagination (C2) ──────────────────────────────────────────────────────────
describe("pagination contract", () => {
  it("normalizes page/limit and clamps to the maximum", () => {
    const p = parsePagination(new URLSearchParams("page=0&limit=100000"), { maxLimit: MAX_LIMIT });
    expect(p.page).toBe(1);
    expect(p.limit).toBe(MAX_LIMIT);
    expect(p.skip).toBe(0);
  });

  it("computes skip from page and limit", () => {
    const p = parsePagination(new URLSearchParams("page=3&limit=20"));
    expect(p.skip).toBe(40);
    expect(p.take).toBe(20);
  });

  it("builds correct pagination meta", () => {
    const meta = buildPaginationMeta(2042, 1, 50);
    expect(meta.totalPages).toBe(41);
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it("wraps data with meta", () => {
    const res = paginated([{ id: 1 }], 1, parsePagination(new URLSearchParams("page=1&limit=50")));
    expect(res.data).toHaveLength(1);
    expect(res.pagination.total).toBe(1);
  });
});
