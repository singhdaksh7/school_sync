import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { statusIsBlocked } from "@/lib/school-access";
import { validateSession } from "@/lib/auth-sessions";
import { systemClock } from "@/lib/clock";

/**
 * Driver auth (Transport Phase B). Mirrors src/lib/parent-auth.ts: Driver is
 * deliberately NOT in UserRole — its own model, own bearer JWT, never touches
 * NextAuth / canAccessSchool / STAFF_ROLES, same precedent as Guardian.
 *
 * KNOWN LIMITATION (documented, not silently worked around): unlike Guardian
 * (SessionActorType.PARENT) and Student/Teacher/Admin staff, there is no
 * `DRIVER` value in the `SessionActorType` enum and no `driverId` column on
 * `AuthSession` / `AuthLoginEvent` (see prisma/schema.prisma). That means a
 * durable, revocable server-side session row cannot be created for a driver
 * without a schema migration (`ALTER TYPE "SessionActorType" ADD VALUE
 * 'DRIVER'` + new nullable columns) — out of scope for this "zero new
 * migrations" phase. Driver JWTs are therefore issued WITHOUT a `sid` claim.
 *
 * The code below still validates `sid` exactly like getAuthenticatedGuardian
 * does, so the moment a future migration adds DRIVER session tracking, this
 * function starts enforcing revocation with no further changes here — but
 * until then, a leaked/stolen driver JWT cannot be remotely revoked before
 * its 7-day expiry. This should get a close look before Driver auth is
 * treated as equivalent to Guardian/Student/Teacher auth in production.
 */

export interface DriverTokenPayload {
  driverId: string;
  name: string;
  phone: string;
  role: "DRIVER";
  schoolId: string;
  schoolSlug: string;
  /** See the module-level note above — never set today, reserved for when DRIVER session tracking lands. */
  sid?: string;
}

export function verifyDriverToken(token: string): DriverTokenPayload | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
    const decoded = jwt.verify(token, secret) as DriverTokenPayload;
    if (!decoded.driverId || !decoded.schoolId || decoded.role !== "DRIVER") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function generateDriverToken(payload: DriverTokenPayload): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export async function getAuthenticatedDriver(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const decoded = verifyDriverToken(token);
  if (!decoded) return null;

  if (decoded.sid) {
    const validation = await validateSession(decoded.sid, systemClock.now());
    if (!validation.valid) return null;
  }

  const driver = await prisma.driver.findFirst({
    where: {
      id: decoded.driverId,
      schoolId: decoded.schoolId,
    },
    select: {
      id: true,
      schoolId: true,
      name: true,
      phone: true,
      email: true,
      isActive: true,
      school: { select: { id: true, slug: true, status: true } },
    },
  });

  if (!driver) return null;
  if (!driver.isActive) return null;
  // A suspended/expired school blocks the driver even with a still-valid JWT.
  if (statusIsBlocked(driver.school.status)) return null;

  return { decoded, driver };
}
