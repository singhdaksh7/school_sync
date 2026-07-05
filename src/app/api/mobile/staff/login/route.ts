import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateStaffForMobile, generateMobileToken } from "@/lib/mobile-auth";
import { NoAccountError, InvalidPasswordError } from "@/lib/auth-errors";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { rateLimitedResponse, authLockResponse, newLoginLimitResponse, genericInvalidCredentialsResponse } from "@/lib/auth-response";
import { authBucketKey, guardAgainstLock, recordFailedCredential, completeSuccessfulLogin, hashIp } from "@/lib/auth-login-flow";
import { systemClock } from "@/lib/clock";
import type { ActorIdentity } from "@/lib/auth-login-quota";

export async function POST(req: NextRequest) {
  try {
    const { email, password, deviceInstallationId, deviceName, platform } = await req.json();
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return genericInvalidCredentialsResponse();
    }

    const ip = getClientIp(req);
    const ipLimit = await rateLimit(`auth-ip:${ip ?? "unknown"}`, RATE_LIMIT_POLICIES.authIp);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

    const now = systemClock.now();
    const trimmedEmail = email.trim();

    // The bucket's school scope: staff accounts resolve their own school via
    // the user row, not the request hostname (an owner/admin may sign in
    // before any white-label domain context exists) — so look it up here too.
    const user = await prisma.user.findUnique({ where: { email: trimmedEmail }, select: { schoolId: true, ownedSchool: { select: { id: true } } } });
    const bucketSchoolId = user?.ownedSchool?.id ?? user?.schoolId ?? null;

    let bucketKey: string | null = null;
    const authFlow = "TEACHER" as const; // shared bucket flow name for all mobile staff (teacher policy is the stricter of the two configured escalation tables and is safe to apply to admin/owner/VP too, since none is specified separately)
    if (bucketSchoolId) {
      bucketKey = authBucketKey(bucketSchoolId, authFlow, trimmedEmail);
      const lock = await guardAgainstLock(bucketKey, now);
      if (lock.locked) return authLockResponse(lock.retryAfterSeconds!);
    } else {
      const legacyLimit = await rateLimit(`mobile-staff-login:${ip ?? "unknown"}:${trimmedEmail.toLowerCase()}`, RATE_LIMIT_POLICIES.login);
      if (!legacyLimit.allowed) return rateLimitedResponse(legacyLimit.retryAfterSeconds);
    }

    let result;
    try {
      result = await authenticateStaffForMobile(trimmedEmail, password, req.headers);
    } catch (err) {
      if (bucketKey && bucketSchoolId && (err instanceof NoAccountError || err instanceof InvalidPasswordError)) {
        const afterFailure = await recordFailedCredential(bucketKey, bucketSchoolId, authFlow, now);
        if (afterFailure.locked) return authLockResponse(afterFailure.retryAfterSeconds!);
      }
      if (err instanceof NoAccountError || err instanceof InvalidPasswordError) return genericInvalidCredentialsResponse();
      throw err;
    }
    if (!result) return genericInvalidCredentialsResponse();

    let sid: string | undefined;
    if (bucketKey && bucketSchoolId) {
      const actor: ActorIdentity = {
        schoolId: bucketSchoolId,
        actorType: result.role === "TEACHER" ? "TEACHER" : "ADMIN_STAFF",
        userId: result.user.id,
        teacherId: "teacherId" in result.user ? result.user.teacherId : null,
      };
      const completion = await completeSuccessfulLogin({
        bucketKey,
        actor,
        device: { deviceInstallationId: deviceInstallationId ?? null, deviceName: deviceName ?? null, platform: platform ?? null },
        now,
        ipHash: ip ? hashIp(ip) : null,
      });
      if (!completion.ok) return newLoginLimitResponse(completion.retryAfterSeconds);
      sid = completion.rawSessionId;
    }

    return NextResponse.json({
      token: generateMobileToken({ ...result.tokenPayload, sid }),
      role: result.role,
      user: result.user,
      school: result.school,
    });
  } catch (error) {
    console.error("Mobile staff login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
