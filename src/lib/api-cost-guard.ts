/**
 * Actor-aware API cost/rate limiting (PART 9, PART 10, PART 11).
 *
 * Authenticated requests are keyed by (schoolId + actorType + actorId +
 * category) — NEVER primarily by IP, so one school's shared NAT/Wi-Fi never
 * throttles a different actor, and Actor A being throttled never affects
 * Actor B even in the same school.
 */

import { NextResponse } from "next/server";
import { rateLimit, RATE_LIMIT_POLICIES, type RateLimitResult } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/auth-response";
import { UPLOAD_GLOBAL_POLICY, UPLOAD_CATEGORY_POLICIES, type ApiCostCategory } from "@/lib/cost-guard-policy";

export type UploadCategoryPolicy = keyof typeof UPLOAD_CATEGORY_POLICIES;

export interface ActorKeyParts {
  schoolId: string;
  actorType: string;
  actorId: string;
}

function actorKey(actor: ActorKeyParts, category: ApiCostCategory | string): string {
  return `cost:${actor.schoolId}:${actor.actorType}:${actor.actorId}:${category}`;
}

/**
 * Phase 4 (PART 10) AI fail-safety: every OTHER category fails open on a
 * limiter-backend outage (see rate-limit.ts) — a Redis blip must never lock
 * a school out of normal ERP reads/mutations. AI_ACTOR/AI_SCHOOL are the one
 * deliberate exception: they gate a real externally-billable provider call
 * (Anthropic), so an unavailable quota backend must deny the provider
 * invocation with a clean temporary response rather than silently letting
 * an unbounded number of billable requests through. This is currently a
 * dormant safeguard — the deployment has no distributed rate-limit backend
 * provisioned yet (MemoryRateLimiter never throws), so it only activates
 * once/if RATE_LIMIT_REDIS_URL/TOKEN are configured and that backend has an
 * outage.
 */
function isAiCategory(category: ApiCostCategory): boolean {
  return category === "AI_ACTOR" || category === "AI_SCHOOL";
}

/** Checks (and consumes) one unit of an actor-scoped API cost category. */
export async function checkActorRateLimit(actor: ActorKeyParts, category: ApiCostCategory): Promise<RateLimitResult> {
  return rateLimit(actorKey(actor, category), RATE_LIMIT_POLICIES[category], { failClosed: isAiCategory(category) });
}

/** Convenience wrapper: returns a ready-to-return 429 response, or null when allowed. */
export async function enforceActorRateLimit(actor: ActorKeyParts, category: ApiCostCategory) {
  const result = await checkActorRateLimit(actor, category);
  if (!result.allowed) return rateLimitedResponse(result.retryAfterSeconds);
  return null;
}

/** School-wide ceiling (e.g. AI_SCHOOL) — same actor-scoping principle, keyed by school only. */
export async function enforceSchoolRateLimit(schoolId: string, category: ApiCostCategory) {
  const result = await rateLimit(`cost:school:${schoolId}:${category}`, RATE_LIMIT_POLICIES[category], { failClosed: isAiCategory(category) });
  if (!result.allowed) return rateLimitedResponse(result.retryAfterSeconds);
  return null;
}

/**
 * Upload quota (PART 24): the global per-actor ceiling AND the category
 * ceiling both apply — whichever is stricter governs. Distributed-safe (uses
 * the same rateLimit() backend as everything else), never an in-memory
 * counter, never keyed by raw PII (actor.actorId is always an internal id).
 */
export async function enforceUploadQuota(actor: ActorKeyParts, category: UploadCategoryPolicy) {
  const globalKey = `upload-global:${actor.schoolId}:${actor.actorType}:${actor.actorId}`;
  const categoryKey = `upload-cat:${actor.schoolId}:${actor.actorType}:${actor.actorId}:${category}`;
  const [globalResult, categoryResult] = await Promise.all([
    rateLimit(globalKey, UPLOAD_GLOBAL_POLICY),
    rateLimit(categoryKey, UPLOAD_CATEGORY_POLICIES[category]),
  ]);
  const denied = !globalResult.allowed ? globalResult : !categoryResult.allowed ? categoryResult : null;
  if (denied) {
    return NextResponse.json(
      { error: "Upload quota exceeded. Please try again later.", code: "UPLOAD_QUOTA_EXCEEDED", retryAfterSeconds: denied.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(denied.retryAfterSeconds) } }
    );
  }
  return null;
}
