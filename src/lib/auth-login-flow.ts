/**
 * Shared "after credentials verified" orchestration (PART 4, PART 5, PART 7),
 * reused by every credential-login entry point (parent/login,
 * mobile/student/login, mobile/staff/login, and the unified mobile/login) so
 * quota/session/lockout semantics are identical everywhere instead of
 * reimplemented per route.
 */

import { hashAuthBucketKey, hashIp } from "@/lib/identifier-hash";
import { checkAuthLock, recordAuthFailure, resetAuthFailures, type AuthFlow, type LockState } from "@/lib/auth-failure";
import { checkLoginQuota, recordLoginEvent, type ActorIdentity, type QuotaCheckResult } from "@/lib/auth-login-quota";
import { createSession, type DeviceInfo } from "@/lib/auth-sessions";
import { withActorLoginLock } from "@/lib/auth-concurrency";
import { FAILED_LOGIN_ESCALATION } from "@/lib/cost-guard-policy";

export function authBucketKey(schoolId: string, authFlow: AuthFlow, identifier: string): string {
  return hashAuthBucketKey(schoolId, authFlow, identifier);
}

/** Call BEFORE attempting password verification. */
export async function guardAgainstLock(bucketKey: string, now: Date): Promise<LockState> {
  return checkAuthLock(bucketKey, now);
}

/** Call after a failed password verification. */
export async function recordFailedCredential(bucketKey: string, schoolId: string, authFlow: AuthFlow, now: Date): Promise<LockState> {
  const policy = FAILED_LOGIN_ESCALATION[authFlow];
  return recordAuthFailure({ bucketKey, schoolId, authFlow, now, policy });
}

export type CompleteLoginResult =
  | { ok: true; rawSessionId: string; oldestSessionRevoked: boolean }
  | { ok: false; code: "NEW_LOGIN_LIMIT_REACHED"; retryAfterSeconds: number | null };

/**
 * Runs after credentials verify successfully: resets the failure-escalation
 * bucket, enforces the successful-login quota (BEFORE creating any session —
 * PART 4), and if allowed, creates/rotates the session and records the login
 * event. An already-issued session is never touched by this function even if
 * the quota is currently exhausted for a LATER attempt.
 */
export async function completeSuccessfulLogin(args: {
  bucketKey: string;
  actor: ActorIdentity;
  device: DeviceInfo;
  now: Date;
  ipHash?: string | null;
}): Promise<CompleteLoginResult> {
  const { bucketKey, actor, device, now, ipHash } = args;
  await resetAuthFailures(bucketKey, now);

  // PART 12 concurrency closure: quota-check, session-cap-eviction, and
  // session-create are serialized per actor inside one advisory-lock
  // transaction — two simultaneous correct-credential requests for the same
  // actor can no longer both read "under quota"/"under cap" and both write.
  return withActorLoginLock(actor, async (tx) => {
    const quota: QuotaCheckResult = await checkLoginQuota(actor, now, tx);
    if (!quota.allowed) {
      return { ok: false, code: "NEW_LOGIN_LIMIT_REACHED", retryAfterSeconds: quota.retryAfterSeconds };
    }

    const { rawSessionId, oldestRevoked } = await createSession(actor, device, now, tx);
    await recordLoginEvent(actor, now, ipHash ?? null, tx);

    return { ok: true, rawSessionId, oldestSessionRevoked: oldestRevoked };
  });
}

export type CompleteWebLoginResult =
  | { ok: true }
  | { ok: false; code: "NEW_LOGIN_LIMIT_REACHED"; retryAfterSeconds: number | null };

/**
 * Web NextAuth variant: quota + audit tracking only, NO AuthSession row.
 * Web (Owner/Admin/VP/Teacher dashboard login) uses NextAuth's own JWT cookie
 * — it has no bearer token to revoke, so creating an AuthSession for it would
 * only pollute the mobile device-limit count with sessions the web flow never
 * validates or revokes. Use {@link completeSuccessfulLogin} for any flow that
 * issues a bearer token (mobile/parent).
 */
export async function completeSuccessfulWebLogin(args: {
  bucketKey: string;
  actor: ActorIdentity;
  now: Date;
  ipHash?: string | null;
}): Promise<CompleteWebLoginResult> {
  const { bucketKey, actor, now, ipHash } = args;
  await resetAuthFailures(bucketKey, now);

  return withActorLoginLock(actor, async (tx) => {
    const quota = await checkLoginQuota(actor, now, tx);
    if (!quota.allowed) {
      return { ok: false, code: "NEW_LOGIN_LIMIT_REACHED", retryAfterSeconds: quota.retryAfterSeconds };
    }

    await recordLoginEvent(actor, now, ipHash ?? null, tx);
    return { ok: true };
  });
}

export { hashIp };
