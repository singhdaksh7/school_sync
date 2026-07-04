import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateParentToken, normalizePhone } from "@/lib/parent-auth";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { statusIsBlocked } from "@/lib/school-access";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
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
    const { phone, password } = await req.json();

    if (!phone || !password) {
      return NextResponse.json(
        { error: "Phone and password are required" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const ip = getClientIp(req);
    const limit = await rateLimit(`parent-login:${ip ?? "unknown"}:${normalizedPhone}`, RATE_LIMIT_POLICIES.login);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const resolvedSchool = await resolveSchool(requestHostname(req));
    const guardians = await findGuardiansForLogin(
      normalizedPhone,
      resolvedSchool?.id
    );

    if (guardians.length === 0) {
      return NextResponse.json({ error: "No account found with that phone number." }, { status: 404 });
    }

    const validGuardians: GuardianWithSchool[] = [];
    for (const guardian of guardians) {
      if (!guardian.passwordHash) continue;
      if (await bcrypt.compare(password, guardian.passwordHash)) validGuardians.push(guardian);
    }

    if (validGuardians.length === 0) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    if (validGuardians.length > 1) {
      return NextResponse.json(
        { error: "Multiple guardian accounts matched this phone. Please contact the school." },
        { status: 409 }
      );
    }

    const guardian = validGuardians[0];
    if (statusIsBlocked(guardian.school.status)) {
      return NextResponse.json({ error: "School access is suspended" }, { status: 403 });
    }
    const token = generateParentToken({
      guardianId: guardian.id,
      name: guardian.name,
      phone: guardian.phone,
      email: guardian.email ?? undefined,
      role: "PARENT",
      schoolId: guardian.schoolId,
      schoolSlug: guardian.school.slug,
    });

    return NextResponse.json({
      success: true,
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
  } catch (error) {
    console.error("Parent login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
