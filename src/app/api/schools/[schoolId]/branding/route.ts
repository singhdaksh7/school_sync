import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
import { normalizeHostname } from "@/lib/school-resolver";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalColor(value: unknown) {
  const color = optionalString(value);
  if (!color) return null;
  return HEX_COLOR_RE.test(color) ? color : undefined;
}

function optionalDomain(value: unknown) {
  const domain = normalizeHostname(optionalString(value));
  if (!domain) return null;
  return DOMAIN_RE.test(domain) ? domain : undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      customDomain: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      appName: true,
      poweredBySchoolSync: true,
    },
  });
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  return NextResponse.json(school);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const customDomain = optionalDomain(body.customDomain);
  const primaryColor = optionalColor(body.primaryColor);
  const secondaryColor = optionalColor(body.secondaryColor);

  if (customDomain === undefined) return NextResponse.json({ error: "Invalid custom domain" }, { status: 400 });
  if (primaryColor === undefined) return NextResponse.json({ error: "Primary color must be a hex color like #2563eb" }, { status: 400 });
  if (secondaryColor === undefined) return NextResponse.json({ error: "Secondary color must be a hex color like #0f172a" }, { status: 400 });

  if (customDomain) {
    const existing = await prisma.school.findFirst({
      where: {
        customDomain: { equals: customDomain, mode: "insensitive" },
        id: { not: schoolId },
      },
      select: { id: true },
    });
    if (existing) return NextResponse.json({ error: "Custom domain is already in use" }, { status: 409 });
  }

  try {
    const updated = await prisma.school.update({
      where: { id: schoolId },
      data: {
        customDomain,
        logoUrl: optionalString(body.logoUrl),
        primaryColor,
        secondaryColor,
        appName: optionalString(body.appName),
        poweredBySchoolSync: body.poweredBySchoolSync !== false,
      },
      select: {
        id: true,
        name: true,
        customDomain: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        appName: true,
        poweredBySchoolSync: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ error: "Custom domain is already in use" }, { status: 409 });
    }
    console.error("Error updating branding:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
