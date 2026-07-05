/**
 * Failed-password escalation (PART 5). Durable PostgreSQL state, not Redis —
 * per PART 33, account-lockout throttling must not disappear if a distributed
 * cache backend is unavailable. Bucketed by (school + normalized identifier +
 * auth flow), NEVER by confirmed account existence, so a nonexistent-account
 * probe still gets a real throttle bucket (no enumeration signal via timing
 * or behavior differences).
 *
 * Atomicity: a single `INSERT ... ON CONFLICT DO UPDATE` is the only
 * concurrency-sensitive write — Postgres serializes concurrent writers on the
 * same row during that statement, so two simultaneous failed attempts for the
 * same bucket can never under-count (no read-then-increment-in-JS race).
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { FAILED_LOGIN_WINDOW_MS, resolveCooldownMs, type EscalationPolicy } from "@/lib/cost-guard-policy";

export type AuthFlow = "PARENT_STUDENT" | "TEACHER";

export interface LockState {
  locked: boolean;
  retryAfterSeconds: number | null;
}

function toLockState(lockedUntil: Date | null, now: Date): LockState {
  if (!lockedUntil || lockedUntil <= now) return { locked: false, retryAfterSeconds: null };
  return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000)) };
}

/** Read-only check — call BEFORE attempting password verification so a locked bucket never even reaches bcrypt. */
export async function checkAuthLock(bucketKey: string, now: Date): Promise<LockState> {
  const state = await prisma.authFailureState.findUnique({ where: { bucketKey }, select: { lockedUntil: true } });
  return toLockState(state?.lockedUntil ?? null, now);
}

/** Records one failed credential attempt and returns the resulting lock state (atomic — see module docs). */
export async function recordAuthFailure(args: {
  bucketKey: string;
  schoolId: string;
  authFlow: AuthFlow;
  now: Date;
  policy: EscalationPolicy;
}): Promise<LockState> {
  const { bucketKey, schoolId, authFlow, now, policy } = args;
  const windowCutoff = new Date(now.getTime() - FAILED_LOGIN_WINDOW_MS);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ failureCount: number }[]>`
      INSERT INTO "AuthFailureState" ("id","bucketKey","schoolId","authFlow","failureCount","windowStartedAt","lastFailureAt","updatedAt")
      VALUES (${randomUUID()}, ${bucketKey}, ${schoolId}, ${authFlow}, 1, ${now}, ${now}, ${now})
      ON CONFLICT ("bucketKey") DO UPDATE SET
        "failureCount" = CASE WHEN "AuthFailureState"."windowStartedAt" < ${windowCutoff} THEN 1 ELSE "AuthFailureState"."failureCount" + 1 END,
        "windowStartedAt" = CASE WHEN "AuthFailureState"."windowStartedAt" < ${windowCutoff} THEN ${now} ELSE "AuthFailureState"."windowStartedAt" END,
        "lastFailureAt" = ${now},
        "updatedAt" = ${now}
      RETURNING "failureCount"
    `;
    const failureCount = Number(rows[0].failureCount);
    const cooldownMs = resolveCooldownMs(policy, failureCount);
    let lockedUntil: Date | null = null;
    if (cooldownMs !== null) {
      lockedUntil = new Date(now.getTime() + cooldownMs);
      await tx.authFailureState.update({ where: { bucketKey }, data: { lockedUntil } });
    } else {
      // Attempts 1-2: make sure a stale lockedUntil from a prior (expired) window is cleared.
      await tx.authFailureState.update({ where: { bucketKey }, data: { lockedUntil: null } });
    }
    return toLockState(lockedUntil, now);
  });
}

/** A successful credential login resets the escalation counter for that bucket (PART 5). */
export async function resetAuthFailures(bucketKey: string, now: Date): Promise<void> {
  await prisma.authFailureState.updateMany({
    where: { bucketKey },
    data: { failureCount: 0, lockedUntil: null, windowStartedAt: now, lastFailureAt: null },
  });
}
