import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { compareStudentsByRollNumber } from "@/lib/student-ordering";

export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(auth.guardian.schoolId, "REPORT_CARDS");
  if (featureDenied) return featureDenied;

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");

  const reportCards = await prisma.reportCard.findMany({
    where: {
      schoolId: auth.guardian.schoolId,
      status: "PUBLISHED",
      ...(studentId ? { studentId } : {}),
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
    orderBy: [{ publishedAt: "desc" }],
  });

  // Universal roll-number ordering (canonical comparator — see /lib/student-ordering)
  // as the tiebreak within each publishedAt instant; comparing publishedAt
  // directly (not via string) keeps the outer recency grouping correct.
  const ordered = [...reportCards].sort((a, b) => {
    const at = a.publishedAt?.getTime() ?? 0;
    const bt = b.publishedAt?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return compareStudentsByRollNumber(a.student, b.student);
  });

  return NextResponse.json({ reportCards: ordered.map(serializeReportCard) });
}
