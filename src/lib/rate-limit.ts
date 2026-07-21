/**
 * Reusable fixed-window rate limiter.
 *
 * Architecture note (read before assuming this is production-grade):
 * The default backend here is process-local (an in-memory Map). That is
 * correct for local development and for a single long-running instance, but
 * on multi-instance / serverless deployments each instance keeps its own
 * counters, so the effective limit is (configured limit × instance count) and
 * counters reset on cold start.
 *
 * This module therefore:
 *   - exposes a backend-agnostic `RateLimiter` interface so a distributed
 *     backend can be slotted in without touching call sites;
 *   - ships a `MemoryRateLimiter` as the safe local/dev default;
 *   - ships two distributed backends selected by `RATE_LIMIT_REDIS_URL`'s
 *     scheme: `RestRedisRateLimiter` for an Upstash-compatible REST endpoint
 *     (`http(s)://`), and `RedisProtocolRateLimiter` for a standard
 *     RESP-protocol store such as AWS ElastiCache Valkey/Redis (`redis://` /
 *     `rediss://`) — a managed REST-over-Redis proxy is not generally
 *     available in front of ElastiCache, so the raw protocol client is
 *     required there;
 *   - warns ONCE at runtime in production when the memory backend is used, so we
 *     never silently pretend a local Map is distributed rate limiting.
 *
 * To make this production-distributed, wire RATE_LIMIT_REDIS_URL (+
 * RATE_LIMIT_REDIS_TOKEN as the bearer token for REST providers, or the AUTH
 * password for protocol-native ones) — see {@link initRateLimiterFromEnv}.
 */

import Redis from "ioredis";
import { AUTH_IP_POLICY, API_COST_POLICIES, UPLOAD_GLOBAL_POLICY, UPLOAD_CATEGORY_POLICIES } from "@/lib/cost-guard-policy";

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

/**
 * Distributed fixed-window limiter backed by an Upstash-compatible Redis REST API
 * (the shape most serverless Redis providers expose). Uses `fetch` only — no SDK
 * dependency — so it works in the Next.js/Neon serverless runtime without adding
 * a vendor package. Provider details never leak to call sites; routes keep using
 * the plain `rateLimit()` function.
 *
 * One atomic pipeline per check: INCR (count), PEXPIRE ... NX (arm the window on
 * the first hit only), PTTL (remaining window for retry-after).
 */
export class RestRedisRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async check(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const namespaced = `ratelimit:${key}`;
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", namespaced],
        ["PEXPIRE", namespaced, String(policy.windowMs), "NX"],
        ["PTTL", namespaced],
      ]),
    });

    if (!res.ok) {
      // Surface a generic error; the caller decides fail-open vs fail-closed. We
      // deliberately do NOT include the provider response body (may leak infra).
      throw new Error(`rate-limit backend responded ${res.status}`);
    }

    const parsed = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(parsed?.[0]?.result ?? 0);
    const pttlMs = Number(parsed?.[2]?.result ?? policy.windowMs);

    if (!Number.isFinite(count) || count <= 0) {
      throw new Error("rate-limit backend returned an unexpected payload");
    }

    if (count > policy.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((pttlMs > 0 ? pttlMs : policy.windowMs) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: Math.max(0, policy.limit - count), retryAfterSeconds: 0 };
  }
}

/**
 * Distributed fixed-window limiter backed by a standard RESP-protocol Redis
 * (or Redis-compatible, e.g. Valkey) server — AWS ElastiCache in particular,
 * which has no Upstash-style REST front door. `token`, when present, is used
 * as the AUTH password (ElastiCache `auth_token` on a TLS-enabled
 * replication group). Same INCR/PEXPIRE-NX/PTTL pipeline as
 * {@link RestRedisRateLimiter} for identical semantics.
 */
export class RedisProtocolRateLimiter implements RateLimiter {
  private client: Redis;

  constructor(url: string, token?: string) {
    this.client = new Redis(url, {
      password: token,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      tls: url.startsWith("rediss://") ? {} : undefined,
    });
    this.client.on("error", () => {
      // Swallow background connection errors — surfaced to callers via the
      // rejected command promise in check(), not here.
    });
  }

  /** Exposes the underlying ioredis connection so other modules that need raw
   * Redis (not just fixed-window counters) can reuse this exact connection
   * instead of opening a second one — see {@link getSharedRedisProtocolClient}. */
  getClient(): Redis {
    return this.client;
  }

  async check(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const namespaced = `ratelimit:${key}`;
    const pipeline = this.client.pipeline();
    pipeline.incr(namespaced);
    pipeline.pexpire(namespaced, policy.windowMs, "NX");
    pipeline.pttl(namespaced);
    const results = await pipeline.exec();
    if (!results) throw new Error("rate-limit backend returned no pipeline result");

    const [incrErr, countRaw] = results[0];
    const [pttlErr, pttlRaw] = results[2];
    if (incrErr) throw incrErr;
    if (pttlErr) throw pttlErr;

    const count = Number(countRaw ?? 0);
    const pttlMs = Number(pttlRaw ?? policy.windowMs);
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error("rate-limit backend returned an unexpected payload");
    }

    if (count > policy.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((pttlMs > 0 ? pttlMs : policy.windowMs) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: Math.max(0, policy.limit - count), retryAfterSeconds: 0 };
  }
}

// Common policies, referenced from route handlers so limits stay consistent.
// Cost Guard (PART 6/9/24) policies live in cost-guard-policy.ts as the single
// source of truth and are re-exposed here so every route keeps using the one
// `rateLimit()` entry point regardless of which policy set a key belongs to.
export const RATE_LIMIT_POLICIES = {
  login: { limit: 8, windowMs: 15 * 60 * 1000 },          // staff/parent/mobile credential attempts (legacy IP+email key — superseded by authIp + the account-scoped lock for new call sites)
  studentLogin: { limit: 10, windowMs: 15 * 60 * 1000 },  // admissionNo + phone-derived password (legacy — see above)
  forgotPassword: { limit: 5, windowMs: 15 * 60 * 1000 }, // strict — avoids reset spam / enumeration
  inviteLookup: { limit: 20, windowMs: 15 * 60 * 1000 },  // invite token validation/acceptance
  payment: { limit: 15, windowMs: 5 * 60 * 1000 },        // create-order / verify-payment
  schoolDeletionSchedule: { limit: 5, windowMs: 15 * 60 * 1000 },  // Founder Danger Zone: schedule deletion (re-auth already gates this, this is the second layer)
  schoolDeletionCancel: { limit: 10, windowMs: 15 * 60 * 1000 },   // Founder Danger Zone: cancel/restore
  authIp: AUTH_IP_POLICY,                                 // secondary network-abuse ceiling for auth endpoints (PART 6)
  ...API_COST_POLICIES,
  uploadGlobal: UPLOAD_GLOBAL_POLICY,
  ...Object.fromEntries(Object.entries(UPLOAD_CATEGORY_POLICIES).map(([k, v]) => [`upload_${k}`, v])),
} as const;

let warnedAboutMemoryBackend = false;
let limiter: RateLimiter = new MemoryRateLimiter();

/** Swap in a distributed limiter (e.g. Redis-backed) during app bootstrap. */
export function setRateLimiter(next: RateLimiter) {
  limiter = next;
}

/** True when the env is configured for a shared/distributed rate-limit backend. */
export function isDistributedRateLimiterConfigured(): boolean {
  return Boolean(process.env.RATE_LIMIT_REDIS_URL && process.env.RATE_LIMIT_REDIS_TOKEN);
}

/** Backend kind currently in use — surfaced by the readiness probe (never secrets). */
export function getRateLimiterKind(): "redis" | "memory" {
  return limiter instanceof RestRedisRateLimiter || limiter instanceof RedisProtocolRateLimiter ? "redis" : "memory";
}

/**
 * Selects the distributed limiter when its env is present. Idempotent and called
 * lazily from {@link rateLimit} so importing this module never forces a backend
 * choice at build time. In production without a shared backend it keeps the
 * memory limiter but warns once (see {@link warnIfNonDistributed}).
 *
 * Backend is chosen by `RATE_LIMIT_REDIS_URL`'s scheme: `http(s)://` selects
 * the Upstash-style REST client, `redis(s)://` selects the RESP-protocol
 * client (ElastiCache Valkey/Redis).
 */
export function initRateLimiterFromEnv(): void {
  if (limiter instanceof RestRedisRateLimiter || limiter instanceof RedisProtocolRateLimiter) return;
  const url = process.env.RATE_LIMIT_REDIS_URL;
  const token = process.env.RATE_LIMIT_REDIS_TOKEN;
  if (!url) return;
  if (url.startsWith("redis://") || url.startsWith("rediss://")) {
    limiter = new RedisProtocolRateLimiter(url, token);
  } else if (token) {
    limiter = new RestRedisRateLimiter(url, token);
  }
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
        "each instance limits independently. Set RATE_LIMIT_REDIS_URL + RATE_LIMIT_REDIS_TOKEN " +
        "to enable the shared backend."
    );
  }
}

/**
 * Applies a named policy to a key. Fail-open on unexpected limiter errors by
 * DEFAULT (availability over strictness) — a limiter outage must not lock
 * users out of login/normal ERP operations. The memory limiter is always
 * available as an in-process fallback, so this branch only triggers on a
 * distributed-backend (e.g. Redis) network/HTTP failure.
 *
 * Phase 4 (PART 10): `failClosed` is an explicit opt-out of that default,
 * for the narrow set of externally-billable categories (AI) where an
 * available-but-wrong-answer quota check is worse than a clean temporary
 * denial — see `api-cost-guard.ts`, which sets this automatically for
 * AI_ACTOR/AI_SCHOOL only. Every other category (login, upload, standard
 * ERP reads/mutations) is completely unaffected by this parameter existing.
 */
/**
 * Returns the shared RESP-protocol ioredis connection when the distributed
 * backend is configured with a `redis://`/`rediss://` URL (ElastiCache
 * Valkey/Redis — see {@link RedisProtocolRateLimiter}), or `null` when no
 * such backend is configured (local/dev, or an Upstash-style REST backend,
 * which has no raw client to share). Callers that need Redis for something
 * other than fixed-window counting (e.g. the driver location-ping store,
 * src/lib/location-store.ts) should use this instead of opening a second
 * connection, and must treat `null` as "distributed Redis unavailable" —
 * never silently fall back to per-instance memory for anything that needs
 * to be read by a different request/instance than the one that wrote it.
 */
export function getSharedRedisProtocolClient(): Redis | null {
  initRateLimiterFromEnv();
  return limiter instanceof RedisProtocolRateLimiter ? limiter.getClient() : null;
}

export async function rateLimit(key: string, policy: RateLimitPolicy, opts: { failClosed?: boolean } = {}): Promise<RateLimitResult> {
  initRateLimiterFromEnv();
  warnIfNonDistributed();
  try {
    return await limiter.check(key, policy);
  } catch (err) {
    if (opts.failClosed) {
      console.error("[rate-limit] limiter error on a cost-sensitive category, failing CLOSED:", err);
      return { allowed: false, remaining: 0, retryAfterSeconds: 30 };
    }
    console.error("[rate-limit] limiter error, failing open:", err);
    return { allowed: true, remaining: policy.limit, retryAfterSeconds: 0 };
  }
}
