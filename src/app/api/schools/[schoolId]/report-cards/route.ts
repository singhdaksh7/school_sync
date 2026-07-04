import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { parsePagination, paginated } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "REPORT_CARDS");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  const examSchemeId = searchParams.get("examSchemeId");
  const status = searchParams.get("status");

  const { skip, take, page, limit } = parsePagination(searchParams, { maxLimit: 500, defaultLimit: 500 });
  const where: Prisma.ReportCardWhereInput = {
    schoolId,
    ...(sectionId ? { sectionId } : {}),
    ...(examSchemeId ? { examSchemeId } : {}),
    ...(status === "DRAFT" || status === "PUBLISHED" ? { status } : {}),
  };
  const [reportCards, total] = await Promise.all([
    prisma.reportCard.findMany({
      where,
      include: reportCardInclude,
      orderBy: [{ status: "asc" }, { student: { rollNo: "asc" } }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.reportCard.count({ where }),
  ]);

  const { pagination } = paginated([], total, { skip, take, page, limit });
  return NextResponse.json({ reportCards: reportCards.map(serializeReportCard), pagination });
}
