import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import {
  buildTemplateData,
  sampleReportCardData,
  templateToSnapshot,
} from "@/lib/report-card-templates";
import type { ReportCardTemplate } from "@/generated/prisma/client";

/**
 * Render a PDF preview of a template using sample student data.
 * Accepts an optional full template config in the body so admins can preview
 * unsaved edits; otherwise the persisted template is used.
 */
export async function POST(
  req: Request,
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

  const template = await prisma.reportCardTemplate.findFirst({ where: { id: templateId, schoolId } });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  let source: ReportCardTemplate = template;
  if (body && Object.keys(body).length > 0) {
    const result = buildTemplateData({ ...body, name: body.name || template.name }, false);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    source = { ...template, ...result.data } as ReportCardTemplate;
  }

  const snapshot = templateToSnapshot(source);
  const sample = sampleReportCardData();
  const pdf = generateReportCardPdf({ ...sample, template: snapshot });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="template-preview-${templateId}.pdf"`,
    },
  });
}
