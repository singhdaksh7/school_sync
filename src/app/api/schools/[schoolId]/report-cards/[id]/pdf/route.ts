import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { reportCardInclude, reportCardToPdfInput } from "@/lib/report-cards";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature, isFeatureEnabled } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; id: string }> }
) {
  const { schoolId, id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARDS");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "PDF");
    if (denied) return denied;
  }

  const card = await prisma.reportCard.findFirst({
    where: { id, schoolId },
    include: reportCardInclude,
  });
  if (!card) return NextResponse.json({ error: "Report card not found" }, { status: 404 });

  const whiteLabelEnabled = await isFeatureEnabled(schoolId, "WHITE_LABEL");
  const pdf = await generateReportCardPdf(reportCardToPdfInput(card, { whiteLabelEnabled }));

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-card-${card.student.rollNo}.pdf"`,
    },
  });
}
