import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { certificateTemplateCreateSchema } from "@/lib/certificates/validation";

const TEMPLATE_SELECT = {
  id: true,
  certificateType: true,
  name: true,
  isActive: true,
  version: true,
  heading: true,
  bodyTemplate: true,
  signatoryName: true,
  signatoryDesignation: true,
  footerText: true,
  logoFileId: true,
  signatureFileId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "TEMPLATE_MANAGE");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const certificateType = req.nextUrl.searchParams.get("certificateType") ?? undefined;
  const templates = await prisma.certificateTemplate.findMany({
    where: { schoolId, ...(certificateType ? { certificateType: certificateType as never } : {}) },
    select: TEMPLATE_SELECT,
    orderBy: [{ certificateType: "asc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json({ data: templates });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const access = await requireCertificateAction(schoolId, userId, "TEMPLATE_MANAGE");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = certificateTemplateCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const template = await prisma.$transaction(async (tx) => {
    if (parsed.data.isActive) {
      await tx.certificateTemplate.updateMany({
        where: { schoolId, certificateType: parsed.data.certificateType, isActive: true },
        data: { isActive: false },
      });
    }
    return tx.certificateTemplate.create({
      data: {
        schoolId,
        certificateType: parsed.data.certificateType,
        name: parsed.data.name,
        heading: parsed.data.heading,
        bodyTemplate: parsed.data.bodyTemplate,
        signatoryName: parsed.data.signatoryName,
        signatoryDesignation: parsed.data.signatoryDesignation,
        footerText: parsed.data.footerText ?? null,
        isActive: parsed.data.isActive ?? true,
        createdById: userId,
      },
      select: TEMPLATE_SELECT,
    });
  });

  await logAudit({
    action: "CERTIFICATE_TEMPLATE_CREATED",
    entityType: "CertificateTemplate",
    entityId: template.id,
    metadata: { certificateType: template.certificateType },
    userId: userId,
    schoolId,
    actorRole: access.actor.role,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ data: template }, { status: 201 });
}
