/**
 * Revocable mobile/API session service (PART 2, PART 7, PART 8). This is the
 * server-side counterpart to a signed mobile JWT: the JWT proves the token
 * hasn't been tampered with, but only this table can say whether the session
 * is still ALLOWED (not revoked, not expired). A cryptographically valid JWT
 * whose AuthSession row is revoked/expired MUST be rejected — see
 * validateSession, wired into getMobileAuth/getAuthenticatedGuardian.
 *
 * Same-device semantics (PART 7): when a login presents a deviceInstallationId
 * that already has a live session for this exact actor, that EXISTING row is
 * rotated in place (fresh token hash + refreshed expiry) rather than counted
 * as a new device — opening the app and re-authenticating on the same
 * installation never consumes a "device slot". The credential event itself
 * still counts against the login quota (that's tracked separately in
 * auth-login-quota.ts) — this module only governs device/session accounting.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuthSession, SessionActorType, Prisma } from "@/generated/prisma/client";
import { hashSessionIdentifier } from "@/lib/identifier-hash";
import { SESSION_LIFETIME_MS, SESSION_TOUCH_INTERVAL_MS, MAX_ACTIVE_SESSIONS } from "@/lib/cost-guard-policy";
import type { Db } from "@/lib/auth-concurrency";

export type RevokeReason =
  | "ACTIVE_SESSION_LIMIT"
  | "USER_LOGOUT"
  | "PASSWORD_RESET"
  | "ACTOR_DISABLED"
  | "TEACHER_DELETED"
  | "SESSION_EXPIRED"
  | "SECURITY_REVOKE";

export interface ActorIdentity {
  schoolId: string;
  actorType: SessionActorType;
  userId?: string | null;
  teacherId?: string | null;
  guardianId?: string | null;
  studentId?: string | null;
}

export interface DeviceInfo {
  deviceInstallationId?: string | null;
  deviceName?: string | null;
  platform?: string | null;
}

function actorIdWhere(actor: ActorIdentity): Prisma.AuthSessionWhereInput {
  return {
    schoolId: actor.schoolId,
    actorType: actor.actorType,
    userId: actor.userId ?? null,
    teacherId: actor.teacherId ?? null,
    guardianId: actor.guardianId ?? null,
    studentId: actor.studentId ?? null,
  };
}

function isActive(session: Pick<AuthSession, "revokedAt" | "expiresAt" | "idleExpiresAt">, now: Date): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt <= now) return false;
  if (session.idleExpiresAt && session.idleExpiresAt <= now) return false;
  return true;
}

function activeWhere(actor: ActorIdentity, now: Date): Prisma.AuthSessionWhereInput {
  return {
    ...actorIdWhere(actor),
    revokedAt: null,
    expiresAt: { gt: now },
    OR: [{ idleExpiresAt: null }, { idleExpiresAt: { gt: now } }],
  };
}

export async function countActiveSessions(actor: ActorIdentity, now: Date, db: Db = prisma): Promise<number> {
  return db.authSession.count({ where: activeWhere(actor, now) });
}

export interface CreateSessionResult {
  session: AuthSession;
  rawSessionId: string;
  oldestRevoked: boolean;
}

/**
 * Creates (or rotates) a session for a successful credential login. Must be
 * called AFTER login-quota + failed-password checks have already passed.
 *
 * `db` defaults to the global client for standalone callers; production
 * login entry points pass the transaction client from `withActorLoginLock`
 * (auth-concurrency.ts) so the count-then-evict-then-create sequence below
 * is race-free against a concurrent identical request for the same actor.
 */
export async function createSession(actor: ActorIdentity, device: DeviceInfo, now: Date, db: Db = prisma): Promise<CreateSessionResult> {
  const lifetime = SESSION_LIFETIME_MS[actor.actorType];
  const rawSessionId = randomUUID();
  const sessionTokenHash = hashSessionIdentifier(rawSessionId);
  const expiresAt = new Date(now.getTime() + lifetime.absoluteMs);
  const idleExpiresAt = new Date(now.getTime() + lifetime.idleMs);

  // Same-device reuse: rotate the existing row in place instead of creating a new one.
  if (device.deviceInstallationId) {
    const existing = await db.authSession.findFirst({
      where: { ...activeWhere(actor, now), deviceInstallationId: device.deviceInstallationId },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const rotated = await db.authSession.update({
        where: { id: existing.id },
        data: {
          sessionTokenHash,
          deviceName: device.deviceName ?? existing.deviceName,
          platform: device.platform ?? existing.platform,
          lastSeenAt: now,
          expiresAt,
          idleExpiresAt,
        },
      });
      return { session: rotated, rawSessionId, oldestRevoked: false };
    }
  }

  const maxActive = MAX_ACTIVE_SESSIONS[actor.actorType];
  let oldestRevoked = false;
  if (maxActive !== undefined) {
    const activeCount = await countActiveSessions(actor, now, db);
    if (activeCount >= maxActive) {
      const oldest = await db.authSession.findFirst({ where: activeWhere(actor, now), orderBy: { createdAt: "asc" } });
      if (oldest) {
        await db.authSession.update({
          where: { id: oldest.id },
          data: { revokedAt: now, revokeReason: "ACTIVE_SESSION_LIMIT" satisfies RevokeReason },
        });
        oldestRevoked = true;
      }
    }
  }

  const session = await db.authSession.create({
    data: {
      schoolId: actor.schoolId,
      actorType: actor.actorType,
      userId: actor.userId ?? null,
      teacherId: actor.teacherId ?? null,
      guardianId: actor.guardianId ?? null,
      studentId: actor.studentId ?? null,
      sessionTokenHash,
      deviceInstallationId: device.deviceInstallationId ?? null,
      deviceName: device.deviceName ?? null,
      platform: device.platform ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      idleExpiresAt,
    },
  });

  return { session, rawSessionId, oldestRevoked };
}

export interface SessionValidation {
  valid: boolean;
  session: AuthSession | null;
  reason?: "NOT_FOUND" | "REVOKED" | "EXPIRED" | "IDLE_EXPIRED";
}

/**
 * Validates a raw session identifier (the `sid` claim from a mobile/parent
 * JWT) against the durable session table, and opportunistically touches
 * lastSeenAt/idleExpiresAt if the touch interval has elapsed (PART 8/34 — no
 * DB write on every request, only when actually stale).
 */
export async function validateSession(rawSessionId: string, now: Date): Promise<SessionValidation> {
  const sessionTokenHash = hashSessionIdentifier(rawSessionId);
  const session = await prisma.authSession.findUnique({ where: { sessionTokenHash } });
  if (!session) return { valid: false, session: null, reason: "NOT_FOUND" };
  if (session.revokedAt) return { valid: false, session, reason: "REVOKED" };
  if (session.expiresAt <= now) return { valid: false, session, reason: "EXPIRED" };
  if (session.idleExpiresAt && session.idleExpiresAt <= now) return { valid: false, session, reason: "IDLE_EXPIRED" };

  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    const lifetime = SESSION_LIFETIME_MS[session.actorType];
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + lifetime.idleMs) },
    });
  }

  return { valid: true, session };
}

export async function revokeSession(sessionId: string, reason: RevokeReason, now: Date): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  });
}

/** Used for password-reset / teacher-deletion cascades (PART 7/29). */
export async function revokeAllSessionsForActor(actor: ActorIdentity, reason: RevokeReason, now: Date): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { ...actorIdWhere(actor), revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  });
  return result.count;
}

export { isActive as isSessionActive };
