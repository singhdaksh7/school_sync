import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { parseAttendanceSummary, reportCardInclude } from "@/lib/report-cards";
import { sessionRole } from "@/lib/tenant";
import {
  assertTeacherScopeAccess,
  getResolvedTeacherScope,
  requireTeacherPermission,
  scopeForbidden,
} from "@/lib/teacher-permission-guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({ where: { userId: session.user.id } });
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "REPORT_CARDS", ["VIEW", "DOWNLOAD"]);
  if (denied) return denied;
  const scope = await getResolvedTeacherScope(teacher.id, teacher.schoolId);
  if (!assertTeacherScopeAccess(scope, teacher.mentorSectionId)) return scopeForbidden();

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

  const pdf = generateReportCardPdf({
    schoolName: card.school.name,
    logoUrl: card.school.logoUrl,
    studentName: card.student.name,
    rollNo: card.student.rollNo,
    classSection: `${card.student.section.class.name}-${card.student.section.name}`,
    examName: card.examScheme.name,
    subjects: card.subjects,
    totalMarks: card.totalMarks,
    percentage: card.percentage,
    grade: card.grade,
    attendance: parseAttendanceSummary(card.attendanceSummary),
    classTeacherRemark: card.classTeacherRemark,
    generatedBy: card.generatedByTeacher.name,
    publishedAt: card.publishedAt?.toISOString() ?? null,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-card-${card.student.rollNo}.pdf"`,
    },
  });
}
