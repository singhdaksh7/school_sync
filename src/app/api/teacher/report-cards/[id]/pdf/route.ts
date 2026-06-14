import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReportCardPdf } from "@/lib/report-card-pdf";
import { reportCardInclude, reportCardToPdfInput } from "@/lib/report-cards";
import { sessionRole } from "@/lib/tenant";

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

  const pdf = generateReportCardPdf(reportCardToPdfInput(card));

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-card-${card.student.rollNo}.pdf"`,
    },
  });
}
