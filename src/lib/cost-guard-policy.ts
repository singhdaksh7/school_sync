/**
 * Cost Guard & Session Hardening — centralized policy constants (PART 32).
 *
 * These are STABLE PRODUCT POLICY, expressed as code constants — not
 * environment variables. Infrastructure/provider values (RATE_LIMIT_REDIS_URL,
 * JOB_WORKER_SECRET, etc.) remain deployment config exactly as before; this
 * file is the single source of truth for every numeric session/quota/rate
 * policy so no magic number is duplicated across route files.
 */

import type { SessionActorType } from "@/generated/prisma/client";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ── Session lifetimes (PART 8) ────────────────────────────────────────────────
export const SESSION_LIFETIME_MS: Record<SessionActorType, { absoluteMs: number; idleMs: number }> = {
  PARENT: { absoluteMs: 30 * DAY_MS, idleMs: 14 * DAY_MS },
  STUDENT: { absoluteMs: 30 * DAY_MS, idleMs: 14 * DAY_MS },
  TEACHER: { absoluteMs: 14 * DAY_MS, idleMs: 7 * DAY_MS },
  // Web NextAuth remains the actual admin session surface (unmodified); this
  // entry only applies to ADMIN_STAFF sessions created via mobile staff login.
  ADMIN_STAFF: { absoluteMs: 14 * DAY_MS, idleMs: 7 * DAY_MS },
};

/** Only persist AuthSession.lastSeenAt if the previous persisted value is older than this — avoids a DB write on every authenticated request (PART 8/34). */
export const SESSION_TOUCH_INTERVAL_MS = 15 * MINUTE_MS;

// ── Active session / device limits (PART 7) ───────────────────────────────────
// ADMIN_STAFF has no entry: per product decision, no device-session cap is
// enforced for Owner/Admin/Vice Principal in this phase.
export const MAX_ACTIVE_SESSIONS: Partial<Record<SessionActorType, number>> = {
  STUDENT: 2,
  PARENT: 3,
  TEACHER: 3,
};

// ── Successful new-login quota (PART 4) ───────────────────────────────────────
export const LOGIN_QUOTA_WINDOW_MS = DAY_MS; // rolling 24h
export const MAX_NEW_LOGINS_PER_WINDOW: Record<SessionActorType, number> = {
  PARENT: 3,
  STUDENT: 3,
  TEACHER: 6,
  ADMIN_STAFF: 8,
};

// ── Failed-password escalation (PART 5) ───────────────────────────────────────
export const FAILED_LOGIN_WINDOW_MS = DAY_MS; // rolling 24h failure-count window

export type EscalationPolicy = {
  /** attempt count -> cooldown/lock duration in ms. Attempts 1-2 have no entry (normal response). */
  cooldownAtAttempt: Record<number, number>;
  /** Duration applied at and beyond the final configured attempt (the "lock"). */
  maxAttempt: number;
};

export const FAILED_LOGIN_ESCALATION: Record<"PARENT_STUDENT" | "TEACHER", EscalationPolicy> = {
  PARENT_STUDENT: {
    cooldownAtAttempt: { 3: 1 * MINUTE_MS, 4: 15 * MINUTE_MS, 5: 6 * HOUR_MS },
    maxAttempt: 5,
  },
  TEACHER: {
    cooldownAtAttempt: { 3: 1 * MINUTE_MS, 4: 10 * MINUTE_MS, 5: 1 * HOUR_MS },
    maxAttempt: 5,
  },
};

/** Resolves the cooldown/lock duration for a given failure count, or null if no cooldown applies yet (attempts 1-2). Counts beyond maxAttempt repeat the max-attempt duration. */
export function resolveCooldownMs(policy: EscalationPolicy, failureCount: number): number | null {
  if (failureCount < 3) return null;
  const attempt = Math.min(failureCount, policy.maxAttempt);
  return policy.cooldownAtAttempt[attempt] ?? policy.cooldownAtAttempt[policy.maxAttempt] ?? null;
}

// ── IP secondary throttle for authentication routes (PART 6) ─────────────────
// Must tolerate an entire school behind one NAT/public Wi-Fi IP — this is a
// coarse abuse ceiling, not the primary control (the account-scoped bucket is).
export const AUTH_IP_POLICY = { limit: 200, windowMs: 15 * MINUTE_MS };

// ── API cost categories (PART 9) ──────────────────────────────────────────────
export const API_COST_POLICIES = {
  STANDARD_READ: { limit: 60, windowMs: MINUTE_MS },
  EXPENSIVE_READ: { limit: 10, windowMs: MINUTE_MS },
  MUTATION: { limit: 20, windowMs: MINUTE_MS },
  UPLOAD: { limit: 10, windowMs: HOUR_MS },
  DOWNLOAD: { limit: 20, windowMs: HOUR_MS },
  PDF: { limit: 15, windowMs: HOUR_MS },
  // Very low burst — a legitimate admin creates one batch/generation job at a
  // time; job dedup (PART 13) is the primary defense against accidental
  // duplicates, this is the backstop against scripted repeat-creation.
  JOB_CREATE: { limit: 5, windowMs: HOUR_MS },
  // Bounded but generous enough for a mobile client polling a running job;
  // the documented client backoff contract (PART 16) is what keeps this cheap
  // in practice — this ceiling exists only to stop a runaway/broken client.
  JOB_STATUS: { limit: 60, windowMs: MINUTE_MS },
  AI_ACTOR: { limit: 10, windowMs: HOUR_MS },
  AI_SCHOOL: { limit: 50, windowMs: DAY_MS },
} as const;

export type ApiCostCategory = keyof typeof API_COST_POLICIES;

// ── Upload quotas (PART 24) ───────────────────────────────────────────────────
// Global ceiling applies to every actor regardless of category; category
// ceilings apply IN ADDITION (the stricter of the two always governs).
export const UPLOAD_GLOBAL_POLICY = { limit: 10, windowMs: HOUR_MS };

export const UPLOAD_CATEGORY_POLICIES = {
  HOMEWORK_ATTACHMENT: { limit: 20, windowMs: DAY_MS },
  HOMEWORK_SUBMISSION: { limit: 10, windowMs: DAY_MS },
  PAYMENT_PROOF: { limit: 5, windowMs: DAY_MS },
  REPORT_CARD_ASSET: { limit: 20, windowMs: DAY_MS },
  BRANDING_IMAGE: { limit: 10, windowMs: DAY_MS },
  STUDENT_IMPORT_SOURCE: { limit: 5, windowMs: DAY_MS },
} as const;

// ── File retention (PART 17) ──────────────────────────────────────────────────
export const HOMEWORK_ATTACHMENT_RETENTION_DAYS = 7; // due date + 7 days
export const HOMEWORK_SUBMISSION_RETENTION_DAYS = 30; // due date + 30 days
export const STUDENT_IMPORT_SUCCESS_RETENTION_DAYS = 3; // terminal success + 3 days
export const STUDENT_IMPORT_FAILURE_RETENTION_DAYS = 7; // terminal failure + 7 days (troubleshooting window)

// ── File retention cleanup job (PART 20) ──────────────────────────────────────
export const FILE_RETENTION_CLEANUP_BATCH_SIZE = 100;
