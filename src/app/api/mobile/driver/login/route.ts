import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDriverToken } from "@/lib/driver-auth";
import { statusIsBlocked } from "@/lib/school-access";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { rateLimitedResponse, genericInvalidCredentialsResponse } from "@/lib/auth-response";

/**
 * Mobile driver login. Structurally mirrors /api/mobile/staff/login, with one
 * deliberate difference: the account-scoped bucket lock / new-login quota /
 * durable session machinery (auth-login-flow.ts, auth-login-quota.ts,
 * auth-sessions.ts) is keyed by `SessionActorType`, which has no `DRIVER`
 * value (see src/lib/driver-auth.ts for the full explanation). Adding one
 * would require a migration, out of scope here. So this route always takes
 * the "no bucket resolved" fallback path that staff/student login already
 * use when the account can't be tied to a school up front — a plain
 * IP+phone-scoped fixed-window limiter (RATE_LIMIT_POLICIES.login, i.e. the
 * same "legacy" tier staff/student login fall back to) plus the shared
 * authIp ceiling. No AuthSession row is created; no `sid` is issued.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const schoolSlug = typeof body.schoolSlug === "string" ? body.schoolSlug : null;

    if (!phone || !password) return genericInvalidCredentialsResponse();

    const ip = getClientIp(req);
    const ipLimit = await rateLimit(`auth-ip:${ip ?? "unknown"}`, RATE_LIMIT_POLICIES.authIp);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

    const legacyLimit = await rateLimit(`mobile-driver-login:${ip ?? "unknown"}:${phone.toLowerCase()}`, RATE_LIMIT_POLICIES.login);
    if (!legacyLimit.allowed) return rateLimitedResponse(legacyLimit.retryAfterSeconds);

    const resolvedSchoolRef =
      (await resolveSchool(hostnameFromHeaders(req.headers))) ??
      (schoolSlug ? await prisma.school.findUnique({ where: { slug: schoolSlug }, select: { id: true } }) : null);

    const where = resolvedSchoolRef ? { schoolId: resolvedSchoolRef.id, phone } : { phone };
    const candidates = await prisma.driver.findMany({
      where,
      include: { school: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } } },
    });

    if (candidates.length === 0) return genericInvalidCredentialsResponse();
    if (candidates.length > 1 && !resolvedSchoolRef) {
      // Same phone number registered as a driver at more than one school and
      // we had no school context to disambiguate — enumeration-safe generic
      // rejection (mirrors AmbiguousSchoolError handling for students, but
      // without leaking "this is ambiguous" since that itself is information).
      return genericInvalidCredentialsResponse();
    }

    const driver = candidates[0];
    if (!driver.isActive || !driver.passwordHash) return genericInvalidCredentialsResponse();
    if (!(await bcrypt.compare(password, driver.passwordHash))) return genericInvalidCredentialsResponse();
    if (statusIsBlocked(driver.school.status)) return genericInvalidCredentialsResponse();

    const token = generateDriverToken({
      driverId: driver.id,
      name: driver.name,
      phone: driver.phone,
      role: "DRIVER",
      schoolId: driver.schoolId,
      schoolSlug: driver.school.slug,
    });

    return NextResponse.json({
      token,
      role: "DRIVER",
      driver: { id: driver.id, name: driver.name, phone: driver.phone, email: driver.email },
      school: { id: driver.school.id, name: driver.school.name, slug: driver.school.slug, logoUrl: driver.school.logoUrl },
    });
  } catch (error) {
    console.error("Mobile driver login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
