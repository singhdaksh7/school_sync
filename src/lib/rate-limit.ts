/**
 * Reusable fixed-window rate limiter.
 *
 * Architecture note (read before assuming this is production-grade):
 * SchoolSync currently has NO Redis/KV infrastructure provisioned. The default
 * backend here is process-local (an in-memory Map). That is correct for local
 * development and for a single long-running instance, but on multi-instance /
 * serverless deployments each instance keeps its own counters, so the effective
 * limit is (configured limit × instance count) and counters reset on cold start.
 *
 * This module therefore:
 *   - exposes a backend-agnostic `RateLimiter` interface so a distributed
 *     backend (e.g. Upstash Redis) can be slotted in without touching call sites;
 *   - ships a `MemoryRateLimiter` as the safe local/dev default;
 *   - warns ONCE at runtime in production when the memory backend is used, so we
 *     never silently pretend a local Map is distributed rate limiting.
 *
 * To make this production-distributed, implement a `RateLimiter` backed by a
 * shared store and set it via {@link setRateLimiter}, wiring these env vars:
 *   RATE_LIMIT_REDIS_URL, RATE_LIMIT_REDIS_TOKEN  (or your provider's equivalents).
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitPolicy = {
  /** Max attempts permitted within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export interface RateLimiter {
  check(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; windowStart: number }>();

  async check(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.windowStart >= policy.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: policy.limit - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    if (bucket.count > policy.limit) {
      const retryAfterSeconds = Math.ceil((bucket.windowStart + policy.windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }
    return { allowed: true, remaining: policy.limit - bucket.count, retryAfterSeconds: 0 };
  }

  /** Test/maintenance helper — clears all counters. */
  reset() {
    this.buckets.clear();
  }
}

// Common policies, referenced from route handlers so limits stay consistent.
export const RATE_LIMIT_POLICIES = {
  login: { limit: 8, windowMs: 15 * 60 * 1000 },          // staff/parent/mobile credential attempts
  studentLogin: { limit: 10, windowMs: 15 * 60 * 1000 },  // admissionNo + phone-derived password
  forgotPassword: { limit: 5, windowMs: 15 * 60 * 1000 }, // strict — avoids reset spam / enumeration
  inviteLookup: { limit: 20, windowMs: 15 * 60 * 1000 },  // invite token validation/acceptance
  payment: { limit: 15, windowMs: 5 * 60 * 1000 },        // create-order / verify-payment
} as const;

let warnedAboutMemoryBackend = false;
let limiter: RateLimiter = new MemoryRateLimiter();

/** Swap in a distributed limiter (e.g. Redis-backed) during app bootstrap. */
export function setRateLimiter(next: RateLimiter) {
  limiter = next;
}

function warnIfNonDistributed() {
  if (
    !warnedAboutMemoryBackend &&
    process.env.NODE_ENV === "production" &&
    limiter instanceof MemoryRateLimiter
  ) {
    warnedAboutMemoryBackend = true;
    console.warn(
      "[rate-limit] Using in-memory rate limiter in production. This is NOT distributed: " +
        "each instance limits independently. Provision a shared backend and call setRateLimiter()."
    );
  }
}

/**
 * Applies a named policy to a key. Fail-open on unexpected limiter errors
 * (availability over strictness) — a limiter outage must not lock users out.
 */
export async function rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  warnIfNonDistributed();
  try {
    return await limiter.check(key, policy);
  } catch (err) {
    console.error("[rate-limit] limiter error, failing open:", err);
    return { allowed: true, remaining: policy.limit, retryAfterSeconds: 0 };
  }
}
