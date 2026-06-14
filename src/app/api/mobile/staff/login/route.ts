import { NextRequest, NextResponse } from "next/server";
import { authenticateStaffForMobile, generateMobileToken } from "@/lib/mobile-auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
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
    console.error("Mobile staff login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
