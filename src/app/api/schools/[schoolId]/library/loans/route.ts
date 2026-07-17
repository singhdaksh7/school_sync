import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, getSchoolTimezone, unauthorized } from "@/lib/library/http";
import { parsePagination, paginated } from "@/lib/pagination";
import { serializeLoan } from "@/lib/library/serializers";
import { isOverdue } from "@/lib/library/fines";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryRead(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const url = new URL(req.url);
  const pagination = parsePagination(url.searchParams);
  const status = url.searchParams.get("status")?.trim();
  const overdueOnly = url.searchParams.get("overdue") === "true";
  const borrowerType = url.searchParams.get("borrowerType")?.trim();
  const borrowerId = url.searchParams.get("borrowerId")?.trim();

  const where: Prisma.LibraryLoanWhereInput = { schoolId };
  if (status === "ACTIVE" || status === "RETURNED" || status === "LOST" || status === "WRITTEN_OFF") where.status = status;
  if (borrowerType === "STUDENT" && borrowerId) where.studentId = borrowerId;
  if (borrowerType === "TEACHER" && borrowerId) where.teacherId = borrowerId;
  if (overdueOnly) {
    where.status = "ACTIVE";
    where.dueAt = { lt: new Date() };
  }

  const timezone = await getSchoolTimezone(schoolId);
  const now = new Date();

  const [rows, total] = await Promise.all([
    prisma.libraryLoan.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: { bookCopy: { include: { book: true } } },
    }),
    prisma.libraryLoan.count({ where }),
  ]);

  const serialized = rows
    .map((l) => serializeLoan(l, { timezone, now }))
    // The dueAt<now prefilter is a coarse UTC guard; refine to school-tz overdue.
    .filter((l) => (overdueOnly ? isOverdue(new Date(l.dueAt), now, timezone) : true));

  return NextResponse.json(paginated(serialized, total, pagination));
}
