import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead, requireLibraryReservationManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, libraryServiceError, unauthorized } from "@/lib/library/http";
import { parsePagination, paginated } from "@/lib/pagination";
import { serializeReservationStaff } from "@/lib/library/serializers";
import { createReservation } from "@/lib/library/service";
import type { Prisma } from "@/generated/prisma/client";

const createSchema = z.object({
  bookId: z.string().trim().min(1),
  borrowerType: z.enum(["STUDENT", "TEACHER"]),
  borrowerId: z.string().trim().min(1),
});

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
  const bookId = url.searchParams.get("bookId")?.trim();

  const where: Prisma.LibraryReservationWhereInput = { schoolId };
  if (status === "PENDING" || status === "FULFILLED" || status === "CANCELLED" || status === "EXPIRED") where.status = status;
  if (bookId) where.bookId = bookId;

  const [rows, total] = await Promise.all([
    prisma.libraryReservation.findMany({
      where,
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: { book: true },
    }),
    prisma.libraryReservation.count({ where }),
  ]);

  // FIFO position among still-pending reservations for the same title.
  const serialized = await Promise.all(
    rows.map(async (r) => {
      let queuePosition: number | undefined;
      if (r.status === "PENDING") {
        const ahead = await prisma.libraryReservation.count({
          where: { schoolId, bookId: r.bookId, status: "PENDING", requestedAt: { lt: r.requestedAt } },
        });
        queuePosition = ahead + 1;
      }
      return serializeReservationStaff(r, { queuePosition });
    })
  );

  return NextResponse.json(paginated(serialized, total, pagination));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryReservationManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await createReservation({
    schoolId,
    bookId: body.bookId,
    borrower: { type: body.borrowerType, id: body.borrowerId },
    actor: { userId: user.userId, role: user.role },
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data, { status: 201 });
}
