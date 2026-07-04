import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { serializeTemplate } from "@/lib/report-card-templates";

export async function POST(
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

  const existing = await prisma.reportCardTemplate.findFirst({ where: { id: templateId, schoolId } });
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Exactly one default per school.
  const template = await prisma.$transaction(async (tx) => {
    await tx.reportCardTemplate.updateMany({
      where: { schoolId, isDefault: true, id: { not: templateId } },
      data: { isDefault: false },
    });
    return tx.reportCardTemplate.update({ where: { id: templateId }, data: { isDefault: true } });
  });

  return NextResponse.json({ template: serializeTemplate(template) });
}
