import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { serializeTemplate } from "@/lib/report-card-templates";
import { Prisma } from "@/generated/prisma/client";

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

  const source = await prisma.reportCardTemplate.findFirst({ where: { id: templateId, schoolId } });
  if (!source) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Copy every config field; a copy is never the default and gets no class
  // assignments. Nullable Json fields must be coerced to DbNull for create input.
  const template = await prisma.reportCardTemplate.create({
    data: {
      schoolId,
      name: `${source.name} (Copy)`,
      description: source.description,
      isDefault: false,
      assignedClassIds: [],
      layoutType: source.layoutType,
      paperSize: source.paperSize,
      logoUrl: source.logoUrl,
      principalSignatureUrl: source.principalSignatureUrl,
      classTeacherSignatureEnabled: source.classTeacherSignatureEnabled,
      stampUrl: source.stampUrl,
      watermarkText: source.watermarkText,
      backgroundImageUrl: source.backgroundImageUrl,
      footerText: source.footerText,
      primaryColor: source.primaryColor,
      secondaryColor: source.secondaryColor,
      showAttendance: source.showAttendance,
      showRank: source.showRank,
      showGrade: source.showGrade,
      showRemarks: source.showRemarks,
      showSubjectTeacherRemarks: source.showSubjectTeacherRemarks,
      showClassTeacherRemarks: source.showClassTeacherRemarks,
      showCoCurricular: source.showCoCurricular,
      showSkills: source.showSkills,
      showDiscipline: source.showDiscipline,
      showAwards: source.showAwards,
      showCustomFields: source.showCustomFields,
      gradeBands: source.gradeBands ?? Prisma.DbNull,
      subjectGroups: source.subjectGroups ?? Prisma.DbNull,
      customSections: source.customSections ?? Prisma.DbNull,
    },
  });

  return NextResponse.json({ template: serializeTemplate(template) }, { status: 201 });
}
