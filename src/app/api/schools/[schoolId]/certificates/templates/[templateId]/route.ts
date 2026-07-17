import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { certificateTemplateUpdateSchema } from "@/lib/certificates/validation";

const TEMPLATE_SELECT = {
  id: true, certificateType: true, name: true, isActive: true, version: true,
  heading: true, bodyTemplate: true, signatoryName: true, signatoryDesignation: true,
  footerText: true, logoFileId: true, signatureFileId: true, createdAt: true, updatedAt: true,
} as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ schoolId: string; templateId: string }> }) {
  const { schoolId, templateId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const access = await requireCertificateAction(schoolId, userId, "TEMPLATE_MANAGE");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const existing = await prisma.certificateTemplate.findFirst({ where: { id: templateId, schoolId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = certificateTemplateUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  // Editing a template's content bumps its version so already-issued
  // certificates keep their originally-recorded templateVersion/templateName
  // snapshot fields meaningfully distinct from the current template state.
  const contentChanged = Boolean(parsed.data.heading || parsed.data.bodyTemplate || parsed.data.footerText !== undefined);

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.isActive) {
      await tx.certificateTemplate.updateMany({
        where: { schoolId, certificateType: existing.certificateType, isActive: true, id: { not: templateId } },
        data: { isActive: false },
      });
    }
    return tx.certificateTemplate.update({
      where: { id: templateId },
      data: {
        ...parsed.data,
        updatedById: userId,
        ...(contentChanged ? { version: { increment: 1 } } : {}),
      },
      select: TEMPLATE_SELECT,
    });
  });

  await logAudit({
    action: parsed.data.isActive ? "CERTIFICATE_TEMPLATE_ACTIVATED" : "CERTIFICATE_TEMPLATE_UPDATED",
    entityType: "CertificateTemplate",
    entityId: templateId,
    userId: userId,
    schoolId,
    actorRole: access.actor.role,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ data: updated });
}
