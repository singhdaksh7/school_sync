import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { serializeLoan, serializeReservationPublic } from "@/lib/library/serializers";
import { getSchoolTimezone } from "@/lib/library/http";

/**
 * Parent read-only view of ONE linked child's library status. The child is
 * verified against the existing StudentGuardian relationship; an unrelated or
 * cross-school studentId returns 404 (non-enumerating), never 403.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const authed = await getAuthenticatedGuardian(req);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { guardian } = authed;

  const denied = await requireSchoolFeature(guardian.schoolId, "LIBRARY");
  if (denied) return denied;

  const canAccess = await guardianCanAccessStudent(guardian.id, guardian.schoolId, studentId);
  if (!canAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const timezone = await getSchoolTimezone(guardian.schoolId);
  const [loans, reservations] = await Promise.all([
    prisma.libraryLoan.findMany({
      where: { schoolId: guardian.schoolId, studentId },
      orderBy: [{ issuedAt: "desc" }],
      take: 100,
      include: { bookCopy: { include: { book: true } } },
    }),
    prisma.libraryReservation.findMany({
      where: { schoolId: guardian.schoolId, studentId },
      orderBy: [{ requestedAt: "desc" }],
      include: { book: true },
    }),
  ]);

  const serializedLoans = loans.map((l) => serializeLoan(l, { timezone }));
  const outstanding = serializedLoans.reduce((sum, l) => sum + Number(l.fineOutstanding), 0);

  const serializedReservations = await Promise.all(
    reservations.map(async (r) => {
      let queuePosition: number | undefined;
      if (r.status === "PENDING") {
        const ahead = await prisma.libraryReservation.count({
          where: { schoolId: guardian.schoolId, bookId: r.bookId, status: "PENDING", requestedAt: { lt: r.requestedAt } },
        });
        queuePosition = ahead + 1;
      }
      return serializeReservationPublic(r, { queuePosition });
    })
  );

  return NextResponse.json({
    studentId,
    loans: serializedLoans,
    reservations: serializedReservations,
    summary: {
      activeLoans: serializedLoans.filter((l) => l.status === "ACTIVE").length,
      overdueLoans: serializedLoans.filter((l) => l.overdue).length,
      outstandingFine: outstanding.toFixed(2),
    },
  });
}
