import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_KEYS, getSchoolFeatureFlags, type FeatureFlagKeyValue } from "@/lib/feature-flags";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { schoolId } = await params;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const flags = await getSchoolFeatureFlags(schoolId);
  return NextResponse.json({ flags });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { schoolId } = await params;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : "";
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;

  if (!FEATURE_FLAG_KEYS.includes(key as FeatureFlagKeyValue) || enabled === null) {
    return NextResponse.json({ error: "Invalid key or enabled value" }, { status: 400 });
  }

  await prisma.schoolFeatureFlag.upsert({
    where: { schoolId_key: { schoolId, key: key as FeatureFlagKeyValue } },
    create: { schoolId, key: key as FeatureFlagKeyValue, enabled },
    update: { enabled },
  });

  const flags = await getSchoolFeatureFlags(schoolId);
  return NextResponse.json({ flags });
}
