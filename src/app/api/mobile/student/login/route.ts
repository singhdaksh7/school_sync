import { NextRequest, NextResponse } from "next/server";
import { authenticateStudentForMobile, generateMobileToken } from "@/lib/mobile-auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = typeof body.admissionNo === "string" && body.admissionNo.trim()
      ? body.admissionNo
      : body.email;
    const password = body.password;

    if (typeof identifier !== "string" || typeof password !== "string" || !identifier.trim() || !password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const result = await authenticateStudentForMobile(identifier, password, req.headers);
    if (!result) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    return NextResponse.json({
      token: generateMobileToken(result.tokenPayload),
      role: "STUDENT",
      student: result.student,
      school: result.school,
    });
  } catch (error) {
    console.error("Mobile student login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
