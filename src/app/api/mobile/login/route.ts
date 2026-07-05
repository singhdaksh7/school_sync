import { NextRequest, NextResponse } from "next/server";
import { unifiedMobileLogin } from "@/lib/unified-mobile-login";
import { generateParentToken } from "@/lib/parent-auth";
import { generateMobileToken } from "@/lib/mobile-auth";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/auth-response";

/**
 * Unified parent/student mobile login (PART 3). Additive — the existing
 * /api/parent/login and /api/mobile/student/login routes are preserved
 * unchanged for current consumers (PART 35).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = typeof body.identifier === "string" ? body.identifier : "";
    const password = typeof body.password === "string" ? body.password : "";
    const schoolSlug = typeof body.schoolSlug === "string" ? body.schoolSlug : null;
    const deviceInstallationId = typeof body.deviceInstallationId === "string" ? body.deviceInstallationId : null;
    const deviceName = typeof body.deviceName === "string" ? body.deviceName : null;
    const platform = typeof body.platform === "string" ? body.platform : null;

    if (!identifier.trim() || !password) {
      return NextResponse.json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    // Secondary network-abuse ceiling (PART 6) — coarse, IP-scoped, tolerant
    // of an entire school behind one NAT. The account-scoped lock in
    // unifiedMobileLogin is the primary control.
    const ip = getClientIp(req);
    const ipLimit = await rateLimit(`auth-ip:${ip ?? "unknown"}`, RATE_LIMIT_POLICIES.authIp);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

    const result = await unifiedMobileLogin({
      identifier,
      password,
      schoolSlug,
      headers: req.headers,
      device: { deviceInstallationId, deviceName, platform },
    });

    if (!result.ok) {
      const body: Record<string, unknown> = { error: result.error, code: result.code };
      if (result.retryAfterSeconds !== undefined) body.retryAfterSeconds = result.retryAfterSeconds;
      return NextResponse.json(body, { status: result.status });
    }

    if (result.actorType === "PARENT") {
      const token = generateParentToken({
        guardianId: result.guardian.id,
        name: result.guardian.name,
        phone: result.guardian.phone,
        email: result.guardian.email ?? undefined,
        role: "PARENT",
        schoolId: result.school.id,
        schoolSlug: result.school.slug,
        sid: result.rawSessionId,
      });
      return NextResponse.json({
        actorType: "PARENT",
        token,
        guardian: result.guardian,
        school: result.school,
        branding: {
          logoUrl: result.school.logoUrl,
          primaryColor: result.school.primaryColor,
          secondaryColor: result.school.secondaryColor,
          appName: result.school.appName,
        },
      });
    }

    const token = generateMobileToken({
      type: "mobile",
      role: "STUDENT",
      studentId: result.student.id,
      schoolId: result.school.id,
      schoolSlug: result.school.slug,
      name: result.student.name,
      email: result.student.email,
      sid: result.rawSessionId,
    });
    return NextResponse.json({
      actorType: "STUDENT",
      token,
      student: result.student,
      school: result.school,
      branding: {
        logoUrl: result.school.logoUrl,
        primaryColor: result.school.primaryColor,
        secondaryColor: result.school.secondaryColor,
        appName: result.school.appName,
      },
    });
  } catch (error) {
    console.error("Unified mobile login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
