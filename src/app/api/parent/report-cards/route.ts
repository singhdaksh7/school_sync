import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { requireSchoolFeature } from "@/lib/feature-flags";

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
    orderBy: [{ publishedAt: "desc" }, { student: { rollNo: "asc" } }],
  });

  return NextResponse.json({ reportCards: reportCards.map(serializeReportCard) });
}
