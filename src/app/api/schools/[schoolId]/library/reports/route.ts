import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryReportView } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, getSchoolTimezone, unauthorized } from "@/lib/library/http";
import { isOverdue } from "@/lib/library/fines";

/**
 * Tenant-scoped library reports. Aggregates only — no student PII beyond
 * class/section grouping labels. Every query is filtered by the server-derived
 * schoolId.
 */
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryReportView(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const now = new Date();
  const timezone = await getSchoolTimezone(schoolId);

  const [titleCounts, copyGroups, activeLoans, fineAgg, acqAgg] = await Promise.all([
    prisma.libraryBook.groupBy({ by: ["status"], where: { schoolId }, _count: { _all: true } }),
    prisma.libraryBookCopy.groupBy({ by: ["status"], where: { schoolId }, _count: { _all: true } }),
    prisma.libraryLoan.findMany({ where: { schoolId, status: "ACTIVE" }, select: { dueAt: true } }),
    prisma.libraryLoan.aggregate({ where: { schoolId }, _sum: { fineAssessed: true, fineWaived: true } }),
    prisma.libraryBookCopy.aggregate({ where: { schoolId }, _sum: { acquisitionCost: true }, _count: { _all: true } }),
  ]);

  const copyByStatus: Record<string, number> = {};
  for (const g of copyGroups) copyByStatus[g.status] = g._count._all;
  const titleByStatus: Record<string, number> = {};
  for (const g of titleCounts) titleByStatus[g.status] = g._count._all;

  const overdueCount = activeLoans.filter((l) => isOverdue(l.dueAt, now, timezone)).length;

  const outstandingFines = new Prisma.Decimal(fineAgg._sum.fineAssessed ?? 0).minus(fineAgg._sum.fineWaived ?? 0);

  const mostBorrowed = await prisma.$queryRaw<{ id: string; title: string; count: bigint }[]>(
    Prisma.sql`
      SELECT b."id", b."title", COUNT(l."id")::bigint AS count
      FROM "LibraryLoan" l
      JOIN "LibraryBookCopy" c ON l."bookCopyId" = c."id"
      JOIN "LibraryBook" b ON c."bookId" = b."id"
      WHERE l."schoolId" = ${schoolId}
      GROUP BY b."id", b."title"
      ORDER BY count DESC, b."title" ASC
      LIMIT 10`
  );

  const byClass = await prisma.$queryRaw<{ className: string; sectionName: string; count: bigint }[]>(
    Prisma.sql`
      SELECT cl."name" AS "className", sec."name" AS "sectionName", COUNT(l."id")::bigint AS count
      FROM "LibraryLoan" l
      JOIN "Student" s ON l."studentId" = s."id"
      JOIN "Section" sec ON s."sectionId" = sec."id"
      JOIN "Class" cl ON sec."classId" = cl."id"
      WHERE l."schoolId" = ${schoolId}
      GROUP BY cl."name", sec."name"
      ORDER BY count DESC`
  );

  return NextResponse.json({
    titles: {
      total: (titleByStatus.ACTIVE ?? 0) + (titleByStatus.ARCHIVED ?? 0),
      active: titleByStatus.ACTIVE ?? 0,
      archived: titleByStatus.ARCHIVED ?? 0,
    },
    copies: {
      total: acqAgg._count._all,
      available: copyByStatus.AVAILABLE ?? 0,
      issued: copyByStatus.ISSUED ?? 0,
      reserved: copyByStatus.RESERVED ?? 0,
      lost: copyByStatus.LOST ?? 0,
      damaged: copyByStatus.DAMAGED ?? 0,
      underRepair: copyByStatus.UNDER_REPAIR ?? 0,
      withdrawn: copyByStatus.WITHDRAWN ?? 0,
    },
    loans: {
      active: activeLoans.length,
      overdue: overdueCount,
    },
    fines: {
      assessedTotal: new Prisma.Decimal(fineAgg._sum.fineAssessed ?? 0).toFixed(2),
      waivedTotal: new Prisma.Decimal(fineAgg._sum.fineWaived ?? 0).toFixed(2),
      outstandingTotal: outstandingFines.toFixed(2),
    },
    inventory: {
      totalAcquisitionCost: new Prisma.Decimal(acqAgg._sum.acquisitionCost ?? 0).toFixed(2),
    },
    mostBorrowed: mostBorrowed.map((r) => ({ bookId: r.id, title: r.title, count: Number(r.count) })),
    borrowingByClass: byClass.map((r) => ({ className: r.className, sectionName: r.sectionName, count: Number(r.count) })),
  });
}
