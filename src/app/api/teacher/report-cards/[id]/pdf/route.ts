import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { reportCardInclude, reportCardToPdfInput } from "@/lib/report-cards";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature, isFeatureEnabled } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await prisma.teacher.findUnique({ where: { userId: teacherAuth.userId } });
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "REPORT_CARDS");
  if (featureDenied) return featureDenied;

  if (!teacher.mentorSectionId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "REPORT_CARDS", "DOWNLOAD", {
    sectionId: teacher.mentorSectionId,
  });
  if (denied) return denied;
  {
    const rateDenied = await enforceActorRateLimit({ schoolId: teacher.schoolId, actorType: "TEACHER", actorId: teacher.id }, "PDF");
    if (rateDenied) return rateDenied;
  }

  const card = await prisma.reportCard.findFirst({
    where: {
      id,
      schoolId: teacher.schoolId,
      sectionId: teacher.mentorSectionId,
      generatedByTeacherId: teacher.id,
    },
    include: reportCardInclude,
  });
  if (!card) return NextResponse.json({ error: "Report card not found" }, { status: 404 });

  const whiteLabelEnabled = await isFeatureEnabled(teacher.schoolId, "WHITE_LABEL");
  const pdf = await generateReportCardPdf(reportCardToPdfInput(card, { whiteLabelEnabled }));

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-card-${card.student.rollNo}.pdf"`,
    },
  });
}
