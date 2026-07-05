/**
 * PII-safe identifier hashing for Cost Guard throttle/session buckets (PART 10).
 * Raw phone numbers/emails must never appear in Redis keys, DB bucket keys, or
 * log lines. A stable SHA-256 of the normalized identifier plus school/flow
 * context is sufficient here — the threat model is "don't leak PII into
 * infrastructure keys/logs", not "resist a targeted offline dictionary attack
 * on the hash itself" (the bucket key is never attacker-visible output; it's
 * an internal lookup key). No secret pepper is used because nothing in the
 * current deployment architecture provides one distinct from NEXTAUTH_SECRET,
 * and reusing that secret here would couple auth-token signing to throttle
 * bucketing for no real benefit — documented in docs/cost-guard-session-architecture.md.
 */

import { createHash } from "node:crypto";

/** Lowercases + trims so "John@Example.com" and " john@example.com " hash identically. */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/** Stable, non-reversible bucket key for an auth-throttle scope: school + auth flow + normalized identifier. */
export function hashAuthBucketKey(schoolScope: string, authFlow: string, identifier: string): string {
  const normalized = normalizeIdentifier(identifier);
  return createHash("sha256").update(`${schoolScope}:${authFlow}:${normalized}`).digest("hex");
}

/** Stable hash of a client IP for audit-safe storage (never store raw IP in a long-lived row unnecessarily). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/** Generic SHA-256 hash of a raw session/token identifier — used to look up AuthSession rows without ever storing the raw value. */
export function hashSessionIdentifier(rawSessionId: string): string {
  return createHash("sha256").update(rawSessionId).digest("hex");
}
