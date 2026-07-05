/**
 * Successful new-login quota — rolling 24h window (PART 4). Durable
 * PostgreSQL history (AuthLoginEvent), not Redis: auditable, survives process
 * restart, and works identically across every app instance since it's the
 * single shared database.
 *
 * IMPORTANT ordering: `checkLoginQuota` must be called AFTER password
 * verification succeeds (never before — checking quota pre-auth would let an
 * attacker probe whether an account is near its quota) but BEFORE the new
 * session is created, so a quota-exhausted actor never gets a new session
 * even though their credentials were correct. An already-issued session
 * keeps working regardless of quota state (this module never touches
 * AuthSession).
 */

import { prisma } from "@/lib/prisma";
import type { SessionActorType, Prisma } from "@/generated/prisma/client";
import { LOGIN_QUOTA_WINDOW_MS, MAX_NEW_LOGINS_PER_WINDOW } from "@/lib/cost-guard-policy";
import type { Db } from "@/lib/auth-concurrency";

export interface ActorIdentity {
  schoolId: string;
  actorType: SessionActorType;
  userId?: string | null;
  teacherId?: string | null;
  guardianId?: string | null;
  studentId?: string | null;
}

export interface QuotaCheckResult {
  allowed: boolean;
  retryAfterSeconds: number | null;
}

function actorIdWhere(actor: ActorIdentity): Prisma.AuthLoginEventWhereInput {
  return {
    schoolId: actor.schoolId,
    actorType: actor.actorType,
    userId: actor.userId ?? null,
    teacherId: actor.teacherId ?? null,
    guardianId: actor.guardianId ?? null,
    studentId: actor.studentId ?? null,
  };
}

/**
 * `db` defaults to the global client for standalone callers (e.g. pilot
 * scripts); production login entry points pass the transaction client from
 * `withActorLoginLock` (auth-concurrency.ts) so this count-then-decide
 * sequence is race-free against a concurrent identical request.
 */
export async function checkLoginQuota(actor: ActorIdentity, now: Date, db: Db = prisma): Promise<QuotaCheckResult> {
  const limit = MAX_NEW_LOGINS_PER_WINDOW[actor.actorType];
  const windowStart = new Date(now.getTime() - LOGIN_QUOTA_WINDOW_MS);
  const where = { ...actorIdWhere(actor), createdAt: { gte: windowStart } };

  const count = await db.authLoginEvent.count({ where });
  if (count < limit) return { allowed: true, retryAfterSeconds: null };

  const oldest = await db.authLoginEvent.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const retryAfterSeconds = oldest
    ? Math.max(1, Math.ceil((oldest.createdAt.getTime() + LOGIN_QUOTA_WINDOW_MS - now.getTime()) / 1000))
    : Math.ceil(LOGIN_QUOTA_WINDOW_MS / 1000);
  return { allowed: false, retryAfterSeconds };
}

/**
 * Records a successful new-login event. Includes a cheap, bounded, probabilistic
 * cleanup of very old rows (older than 2x the quota window) so this table never
 * grows unbounded without needing a dedicated scheduled job — a 1% chance per
 * call keeps the average maintenance cost negligible relative to login volume.
 */
export async function recordLoginEvent(actor: ActorIdentity, now: Date, ipHash?: string | null, db: Db = prisma): Promise<void> {
  await db.authLoginEvent.create({
    data: {
      schoolId: actor.schoolId,
      actorType: actor.actorType,
      userId: actor.userId ?? null,
      teacherId: actor.teacherId ?? null,
      guardianId: actor.guardianId ?? null,
      studentId: actor.studentId ?? null,
      ipHash: ipHash ?? null,
      createdAt: now,
    },
  });

  // Deliberately fire against the GLOBAL client, never `db` — this is an
  // unrelated, independent maintenance sweep; awaiting/nesting it inside the
  // caller's actor-lock transaction would risk "transaction already
  // committed/rolled back" errors from an in-flight write racing $transaction's
  // own commit.
  if (Math.random() < 0.01) {
    const cutoff = new Date(now.getTime() - LOGIN_QUOTA_WINDOW_MS * 2);
    prisma.authLoginEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch((err) => {
      console.error("[auth-login-quota] opportunistic cleanup failed", err);
    });
  }
}
