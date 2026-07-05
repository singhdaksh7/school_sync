import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateStudentForMobile, generateMobileToken } from "@/lib/mobile-auth";
import { NoAccountError, InvalidPasswordError, AmbiguousSchoolError } from "@/lib/auth-errors";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { rateLimitedResponse, authLockResponse, newLoginLimitResponse, genericInvalidCredentialsResponse } from "@/lib/auth-response";
import { authBucketKey, guardAgainstLock, recordFailedCredential, completeSuccessfulLogin, hashIp } from "@/lib/auth-login-flow";
import { systemClock } from "@/lib/clock";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = body.admissionNo;
    const password = body.password;
    const schoolSlug = typeof body.schoolSlug === "string" ? body.schoolSlug : null;
    const deviceInstallationId = typeof body.deviceInstallationId === "string" ? body.deviceInstallationId : null;
    const deviceName = typeof body.deviceName === "string" ? body.deviceName : null;
    const platform = typeof body.platform === "string" ? body.platform : null;

    if (typeof identifier !== "string" || typeof password !== "string" || !identifier.trim() || !password) {
      return genericInvalidCredentialsResponse();
    }

    const ip = getClientIp(req);
    const ipLimit = await rateLimit(`auth-ip:${ip ?? "unknown"}`, RATE_LIMIT_POLICIES.authIp);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

    const now = systemClock.now();
    const resolvedSchoolRef =
      (await resolveSchool(hostnameFromHeaders(req.headers))) ??
      (schoolSlug ? await prisma.school.findUnique({ where: { slug: schoolSlug }, select: { id: true } }) : null);

    let bucketKey: string | null = null;
    if (resolvedSchoolRef) {
      bucketKey = authBucketKey(resolvedSchoolRef.id, "PARENT_STUDENT", identifier.trim());
      const lock = await guardAgainstLock(bucketKey, now);
      if (lock.locked) return authLockResponse(lock.retryAfterSeconds!);
    } else {
      const legacyLimit = await rateLimit(`mobile-student-login:${ip ?? "unknown"}:${identifier.trim().toLowerCase()}`, RATE_LIMIT_POLICIES.studentLogin);
      if (!legacyLimit.allowed) return rateLimitedResponse(legacyLimit.retryAfterSeconds);
    }

    let result;
    try {
      result = await authenticateStudentForMobile(identifier, password, req.headers, { slug: schoolSlug });
    } catch (err) {
      if (bucketKey && resolvedSchoolRef && (err instanceof NoAccountError || err instanceof InvalidPasswordError)) {
        const afterFailure = await recordFailedCredential(bucketKey, resolvedSchoolRef.id, "PARENT_STUDENT", now);
        if (afterFailure.locked) return authLockResponse(afterFailure.retryAfterSeconds!);
      }
      if (err instanceof NoAccountError || err instanceof InvalidPasswordError) return genericInvalidCredentialsResponse();
      if (err instanceof AmbiguousSchoolError) {
        return NextResponse.json(
          { error: "This admission number exists at more than one school. Please log in from your school's portal link." },
          { status: 409 }
        );
      }
      throw err;
    }
    if (!result) return genericInvalidCredentialsResponse();

    let sid: string | undefined;
    if (bucketKey) {
      const completion = await completeSuccessfulLogin({
        bucketKey,
        actor: { schoolId: result.student.schoolId, actorType: "STUDENT", studentId: result.student.id },
        device: { deviceInstallationId, deviceName, platform },
        now,
        ipHash: ip ? hashIp(ip) : null,
      });
      if (!completion.ok) return newLoginLimitResponse(completion.retryAfterSeconds);
      sid = completion.rawSessionId;
    }

    return NextResponse.json({
      token: generateMobileToken({ ...result.tokenPayload, sid }),
      role: "STUDENT",
      student: result.student,
      school: result.school,
    });
  } catch (error) {
    console.error("Mobile student login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
