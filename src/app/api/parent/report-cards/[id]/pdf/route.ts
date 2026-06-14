import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { prisma } from "@/lib/prisma";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { parseAttendanceSummary, reportCardInclude } from "@/lib/report-cards";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
