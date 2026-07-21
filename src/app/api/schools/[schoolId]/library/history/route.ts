import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, unauthorized } from "@/lib/library/http";
import { parsePagination, paginated } from "@/lib/pagination";
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
  const bookId = url.searchParams.get("bookId")?.trim();
  const loanId = url.searchParams.get("loanId")?.trim();
  const event = url.searchParams.get("event")?.trim();

  const where: Prisma.LibraryHistoryWhereInput = { schoolId };
  if (bookId) where.bookId = bookId;
  if (loanId) where.loanId = loanId;
  if (event) where.event = event as Prisma.LibraryHistoryWhereInput["event"];

  const [rows, total] = await Promise.all([
    prisma.libraryHistory.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.libraryHistory.count({ where }),
  ]);

  const serialized = rows.map((h) => ({
    id: h.id,
    event: h.event,
    bookId: h.bookId,
    copyId: h.copyId,
    loanId: h.loanId,
    reservationId: h.reservationId,
    borrowerType: h.borrowerType,
    borrowerId: h.borrowerId,
    previousStatus: h.previousStatus,
    newStatus: h.newStatus,
    fineAmount: h.fineAmount ? h.fineAmount.toFixed(2) : null,
    dueAtBefore: h.dueAtBefore,
    dueAtAfter: h.dueAtAfter,
    reason: h.reason,
    actorId: h.actorId,
    actorRole: h.actorRole,
    createdAt: h.createdAt,
  }));

  return NextResponse.json(paginated(serialized, total, pagination));
}
