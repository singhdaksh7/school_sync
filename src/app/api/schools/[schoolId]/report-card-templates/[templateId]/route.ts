import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { buildTemplateData, serializeTemplate } from "@/lib/report-card-templates";

async function classesBelongToSchool(classIds: string[], schoolId: string) {
  const ids = [...new Set(classIds)];
  if (ids.length === 0) return true;
  const count = await prisma.class.count({ where: { id: { in: ids }, schoolId } });
  return count === ids.length;
}

async function getOwnedTemplate(schoolId: string, templateId: string) {
  return prisma.reportCardTemplate.findFirst({ where: { id: templateId, schoolId } });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; templateId: string }> }
) {
  const { schoolId, templateId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARD_BUILDER");
    if (denied) return denied;
  }

  const template = await getOwnedTemplate(schoolId, templateId);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  return NextResponse.json({ template: serializeTemplate(template) });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; templateId: string }> }
) {
  const { schoolId, templateId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARD_BUILDER");
    if (denied) return denied;
  }

  const existing = await getOwnedTemplate(schoolId, templateId);
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = buildTemplateData(body, false);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const { data } = result;
  if (!(await classesBelongToSchool(data.assignedClassIds, schoolId))) {
    return NextResponse.json({ error: "One or more classes do not belong to this school" }, { status: 400 });
  }

  // isDefault is managed only via the set-default endpoint, not generic PATCH.
  const template = await prisma.reportCardTemplate.update({
    where: { id: templateId },
    data,
  });

  return NextResponse.json({ template: serializeTemplate(template) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; templateId: string }> }
) {
  const { schoolId, templateId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARD_BUILDER");
    if (denied) return denied;
  }

  const existing = await getOwnedTemplate(schoolId, templateId);
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // ReportCard.templateId is ON DELETE SET NULL, and already-generated cards keep
  // their immutable templateSnapshot, so deleting a template never alters history.
  await prisma.reportCardTemplate.delete({ where: { id: templateId } });

  return NextResponse.json({ success: true });
}
