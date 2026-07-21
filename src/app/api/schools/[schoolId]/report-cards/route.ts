import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { parsePagination, paginated } from "@/lib/pagination";
import { Prisma } from "@/generated/prisma/client";
import { buildRollNumberOrderByExprSql } from "@/lib/student-ordering";

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

  // Ordering (report-card status group, then universal roll-number order)
  // must happen at the database level BEFORE skip/take — this endpoint is
  // genuinely paginated, so sorting only the fetched page would silently
  // break page boundaries for an exam scheme/section with more report cards
  // than fit on one page. rollNo is a plain string column with no
  // natural-sort collation, so Prisma's `orderBy` can't express it directly;
  // a small parameterized raw query resolves just the ordered/paginated id
  // slice (every filter value bound as a query parameter, never string-
  // concatenated), and the actual typed rows are then fetched normally
  // through Prisma (preserving `reportCardInclude`'s shape) and re-assembled
  // in that exact order.
  const rawWhereConditions = [Prisma.sql`rc."schoolId" = ${schoolId}`];
  if (sectionId) rawWhereConditions.push(Prisma.sql`rc."sectionId" = ${sectionId}`);
  if (examSchemeId) rawWhereConditions.push(Prisma.sql`rc."examSchemeId" = ${examSchemeId}`);
  if (status === "DRAFT" || status === "PUBLISHED") {
    rawWhereConditions.push(Prisma.sql`rc."status" = ${status}::"ReportCardStatus"`);
  }

  const [orderedIdRows, total] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT rc.id
      FROM "ReportCard" rc
      JOIN "Student" st ON st.id = rc."studentId"
      WHERE ${Prisma.join(rawWhereConditions, " AND ")}
      ORDER BY rc."status" ASC, ${buildRollNumberOrderByExprSql("st")}, rc.id ASC
      LIMIT ${take} OFFSET ${skip}
    `),
    prisma.reportCard.count({ where }),
  ]);

  const orderedIds = orderedIdRows.map((r) => r.id);
  const rows = orderedIds.length
    ? await prisma.reportCard.findMany({ where: { id: { in: orderedIds } }, include: reportCardInclude })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reportCards = orderedIds.map((id) => byId.get(id)!).filter(Boolean);

  const { pagination } = paginated([], total, { skip, take, page, limit });
  return NextResponse.json({ reportCards: reportCards.map(serializeReportCard), pagination });
}
