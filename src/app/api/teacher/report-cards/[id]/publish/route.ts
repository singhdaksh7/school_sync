import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { sessionRole } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({ where: { userId: session.user.id } });
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "REPORT_CARDS");
  if (featureDenied) return featureDenied;

  if (!teacher.mentorSectionId) {
    return NextResponse.json({ error: "Only class mentors can publish report cards" }, { status: 403 });
  }

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "REPORT_CARDS", "PUBLISH", {
    sectionId: teacher.mentorSectionId,
  });
  if (denied) return denied;

  const existing = await prisma.reportCard.findFirst({
    where: {
      id,
      schoolId: teacher.schoolId,
      sectionId: teacher.mentorSectionId,
      generatedByTeacherId: teacher.id,
    },
    include: reportCardInclude,
  });
  if (!existing) return NextResponse.json({ error: "Report card not found" }, { status: 404 });

  if (existing.status === "PUBLISHED") {
    return NextResponse.json({ success: true, reportCard: serializeReportCard(existing) });
  }

  const card = await prisma.reportCard.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
    include: reportCardInclude,
  });

  await logAudit({
    action: "REPORT_CARD_PUBLISHED",
    entityType: "ReportCard",
    entityId: card.id,
    metadata: { studentId: card.studentId, sectionId: card.sectionId },
    userId: session.user.id,
    schoolId: teacher.schoolId,
  });

  return NextResponse.json({ success: true, reportCard: serializeReportCard(card) });
}
