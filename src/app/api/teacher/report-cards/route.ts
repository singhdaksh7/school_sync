import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTeacherForSession, reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { sessionRole } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherForSession(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  if (!teacher.mentorSectionId) return NextResponse.json({ reportCards: [], mentorSection: null, schemes: [] });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "REPORT_CARDS", "VIEW", {
    sectionId: teacher.mentorSectionId,
  });
  if (denied) return denied;

  const [reportCards, schemes] = await Promise.all([
    prisma.reportCard.findMany({
      where: {
        schoolId: teacher.schoolId,
        sectionId: teacher.mentorSectionId,
        generatedByTeacherId: teacher.id,
      },
      include: reportCardInclude,
      orderBy: [{ status: "asc" }, { student: { rollNo: "asc" } }],
    }),
    prisma.examScheme.findMany({
      where: { schoolId: teacher.schoolId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    mentorSection: teacher.mentorSection,
    schemes,
    reportCards: reportCards.map(serializeReportCard),
  });
}
