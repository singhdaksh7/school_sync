import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateParentToken, normalizePhone, GUARDIAN_COOKIE_NAME } from "@/lib/parent-auth";
import { isForwardedHttps } from "@/proxy";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { statusIsBlocked } from "@/lib/school-access";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { rateLimitedResponse, authLockResponse, newLoginLimitResponse, genericInvalidCredentialsResponse } from "@/lib/auth-response";
import { authBucketKey, guardAgainstLock, recordFailedCredential, completeSuccessfulLogin, hashIp } from "@/lib/auth-login-flow";
import { systemClock } from "@/lib/clock";
import bcrypt from "bcryptjs";

function requestHostname(req: NextRequest) {
  return hostnameFromHeaders(req.headers);
}

function findGuardiansForLogin(phone: string, schoolId?: string) {
  return prisma.guardian.findMany({
    where: { phone, ...(schoolId ? { schoolId } : {}) },
    include: {
      school: { select: { id: true, slug: true, status: true } },
    },
  });
}

type GuardianWithSchool = Awaited<ReturnType<typeof findGuardiansForLogin>>[number];

export async function POST(req: NextRequest) {
  try {
    const { phone, password, deviceInstallationId, deviceName, platform } = await req.json();

    if (!phone || !password) {
      return NextResponse.json(
        { error: "Phone and password are required" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return genericInvalidCredentialsResponse();
    }

    const ip = getClientIp(req);
    const ipLimit = await rateLimit(`auth-ip:${ip ?? "unknown"}`, RATE_LIMIT_POLICIES.authIp);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

    const now = systemClock.now();
    const resolvedSchool = await resolveSchool(requestHostname(req));

    // Cost Guard's durable account-scoped lock/quota needs a schoolId. When no
    // school is resolved (no white-label domain, no context yet), this
    // legacy no-context path falls back to the original IP+phone rate limit
    // only — documented, not a regression from prior behavior.
    let bucketKey: string | null = null;
    if (resolvedSchool) {
      bucketKey = authBucketKey(resolvedSchool.id, "PARENT_STUDENT", normalizedPhone);
      const lock = await guardAgainstLock(bucketKey, now);
      if (lock.locked) return authLockResponse(lock.retryAfterSeconds!);
    } else {
      const legacyLimit = await rateLimit(`parent-login:${ip ?? "unknown"}:${normalizedPhone}`, RATE_LIMIT_POLICIES.login);
      if (!legacyLimit.allowed) return rateLimitedResponse(legacyLimit.retryAfterSeconds);
    }

    const guardians = await findGuardiansForLogin(normalizedPhone, resolvedSchool?.id);

    if (guardians.length === 0) {
      if (bucketKey && resolvedSchool) await recordFailedCredential(bucketKey, resolvedSchool.id, "PARENT_STUDENT", now);
      return genericInvalidCredentialsResponse();
    }

    const validGuardians: GuardianWithSchool[] = [];
    for (const guardian of guardians) {
      if (!guardian.passwordHash) continue;
      if (await bcrypt.compare(password, guardian.passwordHash)) validGuardians.push(guardian);
    }

    if (validGuardians.length !== 1) {
      // Zero matches (wrong password) and >1 matches (cross-school ambiguity)
      // both fail closed with the same generic response (PART 3/5) — an
      // unauthenticated caller learns nothing about which case occurred.
      if (bucketKey && resolvedSchool) {
        const afterFailure = await recordFailedCredential(bucketKey, resolvedSchool.id, "PARENT_STUDENT", now);
        if (afterFailure.locked) return authLockResponse(afterFailure.retryAfterSeconds!);
      }
      return genericInvalidCredentialsResponse();
    }

    const guardian = validGuardians[0];
    if (statusIsBlocked(guardian.school.status)) {
      return NextResponse.json({ error: "School access is suspended" }, { status: 403 });
    }

    let sid: string | undefined;
    if (bucketKey) {
      const completion = await completeSuccessfulLogin({
        bucketKey,
        actor: { schoolId: guardian.schoolId, actorType: "PARENT", guardianId: guardian.id },
        device: { deviceInstallationId: deviceInstallationId ?? null, deviceName: deviceName ?? null, platform: platform ?? null },
        now,
        ipHash: ip ? hashIp(ip) : null,
      });
      if (!completion.ok) return newLoginLimitResponse(completion.retryAfterSeconds);
      sid = completion.rawSessionId;
    }

    const token = generateParentToken({
      guardianId: guardian.id,
      name: guardian.name,
      phone: guardian.phone,
      email: guardian.email ?? undefined,
      role: "PARENT",
      schoolId: guardian.schoolId,
      schoolSlug: guardian.school.slug,
      sid,
    });

    const response = NextResponse.json({
      success: true,
      // Retained for the mobile client (frozen contract — see
      // docs/backend-pilot-contract-freeze.md), which has no concept of
      // cookies and stores this itself. The web portal ignores it and
      // relies on the cookie set below instead.
      token,
      user: {
        id: guardian.id,
        name: guardian.name,
        email: guardian.email,
        phone: guardian.phone,
        role: "PARENT",
        schoolId: guardian.schoolId,
        schoolSlug: guardian.school.slug,
      },
    });

    // Guardian web portal session (PART 1) — same JWT as `token` above,
    // carried as an httpOnly cookie so client JS never touches it.
    response.cookies.set(GUARDIAN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isForwardedHttps(req),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // matches generateParentToken's 7d expiry
    });

    return response;
  } catch (error) {
    console.error("Parent login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
