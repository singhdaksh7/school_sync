import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { prisma } from "@/lib/prisma";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { reportCardInclude, reportCardToPdfInput } from "@/lib/report-cards";
import { requireSchoolFeature, isFeatureEnabled } from "@/lib/feature-flags";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(auth.guardian.schoolId, "REPORT_CARDS");
  if (featureDenied) return featureDenied;

  const card = await prisma.reportCard.findFirst({
    where: {
      id,
      schoolId: auth.guardian.schoolId,
      status: "PUBLISHED",
      student: {
        schoolId: auth.guardian.schoolId,
        guardianLinks: {
          some: {
            guardianId: auth.guardian.id,
            schoolId: auth.guardian.schoolId,
          },
        },
      },
    },
    include: reportCardInclude,
  });
  if (!card) return NextResponse.json({ error: "Report card not found" }, { status: 404 });

  const whiteLabelEnabled = await isFeatureEnabled(auth.guardian.schoolId, "WHITE_LABEL");
  const pdf = await generateReportCardPdf(reportCardToPdfInput(card, { whiteLabelEnabled }));

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-card-${card.student.rollNo}.pdf"`,
    },
  });
}
