import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead, requireLibraryCopyManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, unauthorized } from "@/lib/library/http";
import { serializeCopy } from "@/lib/library/serializers";
import { logAudit } from "@/lib/audit";
import { recordLibraryHistory } from "@/lib/library/history";

const copyInput = z.object({
  accessionNumber: z.string().trim().min(1).max(60),
  barcode: z.string().trim().min(1).max(60),
  shelfLocation: z.string().trim().max(120).optional(),
  acquisitionDate: z.string().datetime().optional(),
  acquisitionCost: z.number().nonnegative().optional(),
  condition: z.string().trim().max(120).optional(),
});
const bulkSchema = z.object({ copies: z.array(copyInput).min(1).max(500) });

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryRead(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const book = await prisma.libraryBook.findFirst({ where: { id, schoolId }, select: { id: true } });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const copies = await prisma.libraryBookCopy.findMany({
    where: { schoolId, bookId: id },
    orderBy: { accessionNumber: "asc" },
  });
  return NextResponse.json(copies.map(serializeCopy));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryCopyManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const book = await prisma.libraryBook.findFirst({ where: { id, schoolId }, select: { id: true, status: true } });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (book.status !== "ACTIVE") return NextResponse.json({ error: "Cannot add copies to an archived book", code: "ARCHIVED" }, { status: 409 });

  let body: z.infer<typeof bulkSchema>;
  try {
    body = bulkSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // In-batch duplicate detection (clear 400, not a DB 500).
  const accSet = new Set<string>();
  const barSet = new Set<string>();
  for (const c of body.copies) {
    if (accSet.has(c.accessionNumber)) return NextResponse.json({ error: `Duplicate accession number in request: ${c.accessionNumber}`, code: "DUPLICATE_ACCESSION" }, { status: 400 });
    if (barSet.has(c.barcode)) return NextResponse.json({ error: `Duplicate barcode in request: ${c.barcode}`, code: "DUPLICATE_BARCODE" }, { status: 400 });
    accSet.add(c.accessionNumber);
    barSet.add(c.barcode);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const c of body.copies) {
        const row = await tx.libraryBookCopy.create({
          data: {
            schoolId,
            bookId: id,
            accessionNumber: c.accessionNumber,
            barcode: c.barcode,
            shelfLocation: c.shelfLocation ?? null,
            acquisitionDate: c.acquisitionDate ? new Date(c.acquisitionDate) : null,
            acquisitionCost: c.acquisitionCost != null ? new Prisma.Decimal(c.acquisitionCost) : null,
            condition: c.condition ?? null,
          },
        });
        await recordLibraryHistory(tx, {
          schoolId,
          event: "COPY_ADDED",
          bookId: id,
          copyId: row.id,
          newStatus: row.status,
          actorId: user.userId,
          actorRole: user.role,
        });
        rows.push(row);
      }
      return rows;
    });

    await logAudit({
      action: "LIBRARY_COPY_ADDED",
      entityType: "LibraryBook",
      entityId: id,
      userId: user.userId,
      schoolId,
      actorRole: user.role,
      metadata: { count: created.length },
    });

    return NextResponse.json(created.map(serializeCopy), { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
      const code = target.includes("barcode") ? "DUPLICATE_BARCODE" : "DUPLICATE_ACCESSION";
      return NextResponse.json({ error: "A copy with that accession number or barcode already exists", code }, { status: 409 });
    }
    throw e;
  }
}
