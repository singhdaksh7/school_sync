import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { resolveManagedOrLegacyFileUrl } from "@/lib/file-service";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalColor(value: unknown) {
  const color = optionalString(value);
  if (!color) return null;
  return HEX_COLOR_RE.test(color) ? color : undefined;
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
  {
    const denied = await requireSchoolFeature(schoolId, "WHITE_LABEL");
    if (denied) return denied;
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      customDomain: true,
      logoUrl: true,
      logoFileId: true,
      primaryColor: true,
      secondaryColor: true,
      appName: true,
      poweredBySchoolSync: true,
    },
  });
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  const logoUrl = await resolveManagedOrLegacyFileUrl(school.logoUrl, school.logoFileId);
  return NextResponse.json({ ...school, logoUrl });
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
  {
    const denied = await requireSchoolFeature(schoolId, "WHITE_LABEL");
    if (denied) return denied;
  }

  // Custom-domain mutation now lives in its own verified-ownership flow (see
  // /api/schools/[schoolId]/custom-domain) — this route no longer accepts a
  // bare `customDomain` claim, since setting it here used to activate host
  // resolution with zero proof of domain control.
  const body = await req.json();
  const primaryColor = optionalColor(body.primaryColor);
  const secondaryColor = optionalColor(body.secondaryColor);

  if (primaryColor === undefined) return NextResponse.json({ error: "Primary color must be a hex color like #2563eb" }, { status: 400 });
  if (secondaryColor === undefined) return NextResponse.json({ error: "Secondary color must be a hex color like #0f172a" }, { status: 400 });

  try {
    const updated = await prisma.school.update({
      where: { id: schoolId },
      data: {
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
        logoFileId: true,
        primaryColor: true,
        secondaryColor: true,
        appName: true,
        poweredBySchoolSync: true,
      },
    });

    const logoUrl = await resolveManagedOrLegacyFileUrl(updated.logoUrl, updated.logoFileId);
    return NextResponse.json({ ...updated, logoUrl });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ error: "Custom domain is already in use" }, { status: 409 });
    }
    console.error("Error updating branding:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
