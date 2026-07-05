import { describe, it, expect, afterEach } from "vitest";
import { MemoryRateLimiter, rateLimit, setRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { checkActorRateLimit } from "@/lib/api-cost-guard";

describe("MemoryRateLimiter", () => {
  it("allows up to the limit then throttles within the window", async () => {
    const limiter = new MemoryRateLimiter();
    const policy = { limit: 3, windowMs: 60_000 };
    const key = "user:1";

    expect((await limiter.check(key, policy)).allowed).toBe(true); // 1
    expect((await limiter.check(key, policy)).allowed).toBe(true); // 2
    expect((await limiter.check(key, policy)).allowed).toBe(true); // 3
    const blocked = await limiter.check(key, policy); // 4 → over limit
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", async () => {
    const limiter = new MemoryRateLimiter();
    const policy = { limit: 1, windowMs: 60_000 };
    expect((await limiter.check("a", policy)).allowed).toBe(true);
    expect((await limiter.check("a", policy)).allowed).toBe(false);
    expect((await limiter.check("b", policy)).allowed).toBe(true); // separate bucket
  });

  it("resets after the window elapses", async () => {
    const limiter = new MemoryRateLimiter();
    const policy = { limit: 1, windowMs: 1 }; // 1ms window
    expect((await limiter.check("k", policy)).allowed).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect((await limiter.check("k", policy)).allowed).toBe(true); // window rolled over
  });
});

// ── Phase 4 PART 10: AI fail-closed on a limiter-backend outage ──────────────
class ThrowingRateLimiter implements RateLimiter {
  async check(): Promise<never> {
    throw new Error("simulated distributed backend outage");
  }
}

describe("rateLimit — fail-open vs fail-closed on a limiter error", () => {
  afterEach(() => setRateLimiter(new MemoryRateLimiter()));

  it("fails OPEN by default (normal ERP categories must survive a limiter outage)", async () => {
    setRateLimiter(new ThrowingRateLimiter());
    const result = await rateLimit("k", { limit: 5, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
  });

  it("fails CLOSED when failClosed is explicitly requested", async () => {
    setRateLimiter(new ThrowingRateLimiter());
    const result = await rateLimit("k", { limit: 5, windowMs: 60_000 }, { failClosed: true });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("checkActorRateLimit fails CLOSED for AI_ACTOR/AI_SCHOOL but stays OPEN for a normal category", async () => {
    setRateLimiter(new ThrowingRateLimiter());
    const actor = { schoolId: "s1", actorType: "ADMIN_STAFF", actorId: "u1" };

    const ai = await checkActorRateLimit(actor, "AI_ACTOR");
    expect(ai.allowed).toBe(false);

    const standard = await checkActorRateLimit(actor, "STANDARD_READ");
    expect(standard.allowed).toBe(true);
  });
});
