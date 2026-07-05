/**
 * Phase 4 concurrency closure (PART 12): both the successful-login quota
 * (auth-login-quota.ts) and the active-session cap/eviction
 * (auth-sessions.ts) were count-then-write sequences with no transaction or
 * lock between the read and the write — two concurrent successful-login
 * requests for the SAME actor could both read "under quota"/"under cap" and
 * both insert, exceeding the configured limit.
 *
 * Fix: a Postgres transaction-scoped advisory lock
 * (`pg_advisory_xact_lock`), keyed by the actor identity, wrapping the whole
 * "check quota → evict oldest session if needed → create session → record
 * login event" sequence for ONE actor. `pg_advisory_xact_lock` auto-releases
 * at COMMIT/ROLLBACK — it can never leak across a crashed request the way a
 * manually-released `pg_advisory_lock` could. Concurrent logins for
 * DIFFERENT actors are completely unaffected (the lock key is per-actor, not
 * global) — this is not a global auth mutex.
 *
 * Chosen over SERIALIZABLE isolation + retry: simpler (no retry loop needed
 * anywhere), and correct at the default READ COMMITTED level since the
 * advisory lock itself is what provides the mutual exclusion.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type Db = Prisma.TransactionClient | typeof prisma;

export interface LockableActorIdentity {
  schoolId: string;
  actorType: string;
  userId?: string | null;
  teacherId?: string | null;
  guardianId?: string | null;
  studentId?: string | null;
}

function actorLockKey(actor: LockableActorIdentity): string {
  return `login:${actor.schoolId}:${actor.actorType}:${actor.userId ?? ""}:${actor.teacherId ?? ""}:${actor.guardianId ?? ""}:${actor.studentId ?? ""}`;
}

/**
 * Runs `fn` inside a transaction holding an actor-scoped advisory lock —
 * every "complete a successful login" call for the same actor is fully
 * serialized against every other one, closing the login-quota and
 * active-session-cap races together in one mechanism (both live inside this
 * same logical operation for a given actor).
 */
export async function withActorLoginLock<T>(actor: LockableActorIdentity, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const key = actorLockKey(actor);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
    return fn(tx);
  });
}
