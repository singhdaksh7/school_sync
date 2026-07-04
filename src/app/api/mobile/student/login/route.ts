import { NextRequest, NextResponse } from "next/server";
import { authenticateStudentForMobile, generateMobileToken } from "@/lib/mobile-auth";
import { NoAccountError, InvalidPasswordError, AmbiguousSchoolError } from "@/lib/auth-errors";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = body.admissionNo;
    const password = body.password;

    if (typeof identifier !== "string" || typeof password !== "string" || !identifier.trim() || !password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const ip = getClientIp(req);
    const limit = await rateLimit(`mobile-student-login:${ip ?? "unknown"}:${identifier.trim().toLowerCase()}`, RATE_LIMIT_POLICIES.studentLogin);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const result = await authenticateStudentForMobile(identifier, password, req.headers, {
      slug: typeof body.schoolSlug === "string" ? body.schoolSlug : null,
    });
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
    if (error instanceof AmbiguousSchoolError) {
      return NextResponse.json(
        { error: "This admission number exists at more than one school. Please log in from your school's portal link." },
        { status: 409 }
      );
    }
    console.error("Mobile student login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
