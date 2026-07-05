/**
 * Consistent rate-limit / auth-throttle HTTP response contract (PART 12).
 * Never exposes internal Redis/DB state, limit keys, normalized identifiers,
 * or whether a target account exists — only a generic message, a
 * machine-readable code, and (where applicable) retryAfterSeconds.
 */

import { NextResponse } from "next/server";

function withRetryAfter(body: Record<string, unknown>, status: number, retryAfterSeconds: number | null) {
  const headers = retryAfterSeconds !== null ? { "Retry-After": String(retryAfterSeconds) } : undefined;
  return NextResponse.json({ ...body, retryAfterSeconds }, { status, headers });
}

/** Generic API/network rate-limit rejection (STANDARD_READ, EXPENSIVE_READ, MUTATION, UPLOAD, etc.). */
export function rateLimitedResponse(retryAfterSeconds: number) {
  return withRetryAfter({ error: "Too many requests", code: "RATE_LIMITED" }, 429, retryAfterSeconds);
}

/** Threshold separating a short "cooldown" tier (1/10/15 min) from a longer "lock" tier (1h/6h) for the response code only — both use HTTP 429. */
const LOCK_TIER_THRESHOLD_SECONDS = 20 * 60;

/** Failed-password escalation response (PART 5). */
export function authLockResponse(retryAfterSeconds: number) {
  const code = retryAfterSeconds > LOCK_TIER_THRESHOLD_SECONDS ? "AUTH_TEMPORARILY_LOCKED" : "AUTH_COOLDOWN_ACTIVE";
  return withRetryAfter({ error: "Unable to sign in right now. Please try again later.", code }, 429, retryAfterSeconds);
}

/** Successful-new-login quota exhausted (PART 4) — existing sessions are unaffected; only NEW credential logins are denied. */
export function newLoginLimitResponse(retryAfterSeconds: number | null) {
  return withRetryAfter(
    { error: "Too many new sign-ins. Please try again later.", code: "NEW_LOGIN_LIMIT_REACHED" },
    429,
    retryAfterSeconds
  );
}

/** Generic, enumeration-safe invalid-credentials response — never distinguishes "no account" from "wrong password" for the new Cost-Guard-hardened entry points. */
export function genericInvalidCredentialsResponse() {
  return NextResponse.json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }, { status: 401 });
}
