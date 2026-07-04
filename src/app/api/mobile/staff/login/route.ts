import { NextRequest, NextResponse } from "next/server";
import { authenticateStaffForMobile, generateMobileToken } from "@/lib/mobile-auth";
import { NoAccountError, InvalidPasswordError } from "@/lib/auth-errors";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const ip = getClientIp(req);
    const limit = await rateLimit(`mobile-staff-login:${ip ?? "unknown"}:${email.trim().toLowerCase()}`, RATE_LIMIT_POLICIES.login);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const result = await authenticateStaffForMobile(email.trim(), password, req.headers);
    if (!result) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    return NextResponse.json({
      token: generateMobileToken(result.tokenPayload),
      role: result.role,
      user: result.user,
      school: result.school,
    });
  } catch (error) {
    if (error instanceof NoAccountError) {
      return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
    }
    if (error instanceof InvalidPasswordError) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }
    console.error("Mobile staff login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
