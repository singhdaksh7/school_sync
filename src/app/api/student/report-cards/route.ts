import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const featureDenied = await requireSchoolFeature(auth.schoolId, "REPORT_CARDS");
    if (featureDenied) return featureDenied;

    const cards = await prisma.reportCard.findMany({
      where: {
        schoolId: auth.schoolId,
        studentId: auth.studentId,
        status: "PUBLISHED", // never expose DRAFT cards
      },
      include: reportCardInclude,
      orderBy: [{ publishedAt: "desc" }],
    });

    const reportCards = cards.map((card) => {
      const serialized = serializeReportCard(card);
      return {
        ...serialized,
        // pdfUrl is the stored document (may be null); surface it as actionUrl
        // so the mobile app can open it when present.
        actionUrl: serialized.pdfUrl ?? null,
      };
    });

    return NextResponse.json({ reportCards });
  } catch (error) {
    console.error("Error fetching student report cards:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
