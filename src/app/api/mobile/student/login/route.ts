import { NextRequest, NextResponse } from "next/server";
import { authenticateStudentForMobile, generateMobileToken } from "@/lib/mobile-auth";
import { NoAccountError, InvalidPasswordError } from "@/lib/auth-errors";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = body.admissionNo;
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
    if (error instanceof NoAccountError) {
      return NextResponse.json({ error: "No account found with that admission number." }, { status: 404 });
    }
    if (error instanceof InvalidPasswordError) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }
    console.error("Mobile student login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
