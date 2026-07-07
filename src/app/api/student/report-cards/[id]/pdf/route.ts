import { NextResponse } from "next/server";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { prisma } from "@/lib/prisma";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { reportCardInclude, reportCardToPdfInput } from "@/lib/report-cards";
import { requireSchoolFeature, isFeatureEnabled } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

// Mirrors GET /api/parent/report-cards/[id]/pdf exactly (same PDF generator,
// same PDF Cost Guard category) — scoped to the authenticated Student's own
// report card instead of a guardian-linked student's.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(auth.schoolId, "REPORT_CARDS");
  if (featureDenied) return featureDenied;

  const rateDenied = await enforceActorRateLimit({ schoolId: auth.schoolId, actorType: "STUDENT", actorId: auth.studentId }, "PDF");
  if (rateDenied) return rateDenied;

  const card = await prisma.reportCard.findFirst({
    where: { id, schoolId: auth.schoolId, studentId: auth.studentId, status: "PUBLISHED" },
    include: reportCardInclude,
  });
  if (!card) return NextResponse.json({ error: "Report card not found" }, { status: 404 });

  const whiteLabelEnabled = await isFeatureEnabled(auth.schoolId, "WHITE_LABEL");
  const pdf = await generateReportCardPdf(reportCardToPdfInput(card, { whiteLabelEnabled }));

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-card-${card.student.rollNo}.pdf"`,
    },
  });
}
