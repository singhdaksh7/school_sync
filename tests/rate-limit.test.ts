import { describe, it, expect } from "vitest";
import { MemoryRateLimiter } from "@/lib/rate-limit";

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
