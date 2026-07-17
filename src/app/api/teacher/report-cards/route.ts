import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { getTeacherForSession, reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { compareStudentsByRollNumber } from "@/lib/student-ordering";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherForSession(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "REPORT_CARDS");
  if (featureDenied) return featureDenied;
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
      orderBy: [{ status: "asc" }],
    }),
    prisma.examScheme.findMany({
      where: { schoolId: teacher.schoolId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Universal roll-number ordering (canonical comparator — see /lib/student-ordering)
  // as the tiebreak within each status group. Status order is the real enum
  // declaration order (prisma/schema.prisma ReportCardStatus: DRAFT, PUBLISHED)
  // — not a string comparison, which would only coincidentally match it.
  const REPORT_CARD_STATUS_ORDER = ["DRAFT", "PUBLISHED"] as const;
  const orderedReportCards = [...reportCards].sort((a, b) => {
    if (a.status !== b.status) return REPORT_CARD_STATUS_ORDER.indexOf(a.status) - REPORT_CARD_STATUS_ORDER.indexOf(b.status);
    return compareStudentsByRollNumber(a.student, b.student);
  });

  return NextResponse.json({
    mentorSection: teacher.mentorSection,
    schemes,
    reportCards: orderedReportCards.map(serializeReportCard),
  });
}
