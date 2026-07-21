import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead, requireLibraryCatalogueManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, unauthorized } from "@/lib/library/http";
import { serializeBook, serializeCopy } from "@/lib/library/serializers";
import { logAudit } from "@/lib/audit";
import { recordLibraryHistory } from "@/lib/library/history";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  subtitle: z.string().trim().max(300).nullable().optional(),
  authors: z.string().trim().max(500).nullable().optional(),
  isbn10: z.string().trim().max(20).nullable().optional(),
  isbn13: z.string().trim().max(20).nullable().optional(),
  publisher: z.string().trim().max(200).nullable().optional(),
  edition: z.string().trim().max(100).nullable().optional(),
  publicationYear: z.number().int().min(0).max(3000).nullable().optional(),
  language: z.string().trim().max(60).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  subject: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  coverFileId: z.string().trim().nullable().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryRead(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const book = await prisma.libraryBook.findFirst({
    where: { id, schoolId },
    include: { copies: { orderBy: { accessionNumber: "asc" } } },
  });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ...serializeBook(book),
    copies: book.copies.map(serializeCopy),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryCatalogueManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const existing = await prisma.libraryBook.findFirst({ where: { id, schoolId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.coverFileId) {
    const file = await prisma.storedFile.findFirst({
      where: { id: body.coverFileId, schoolId, category: "LIBRARY_BOOK_COVER", deletedAt: null },
      select: { id: true },
    });
    if (!file) return NextResponse.json({ error: "Invalid cover file" }, { status: 400 });
  }

  const book = await prisma.$transaction(async (tx) => {
    const updated = await tx.libraryBook.update({
      where: { id },
      data: { ...body, updatedById: user.userId },
    });
    await recordLibraryHistory(tx, {
      schoolId,
      event: "BOOK_UPDATED",
      bookId: id,
      actorId: user.userId,
      actorRole: user.role,
    });
    return updated;
  });

  await logAudit({
    action: "LIBRARY_BOOK_UPDATED",
    entityType: "LibraryBook",
    entityId: id,
    userId: user.userId,
    schoolId,
    actorRole: user.role,
  });

  return NextResponse.json(serializeBook(book));
}

/**
 * Archive (never hard-delete). A book with any copies that carry loan history is
 * preserved via LibraryBook.status = ARCHIVED. Restore by re-archiving=false.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryCatalogueManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const book = await prisma.libraryBook.findFirst({ where: { id, schoolId }, select: { id: true, status: true } });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Refuse to archive while copies are still on active loan.
  const activeLoans = await prisma.libraryLoan.count({
    where: { schoolId, status: "ACTIVE", bookCopy: { bookId: id } },
  });
  if (activeLoans > 0) {
    return NextResponse.json({ error: "Cannot archive a book with active loans", code: "ACTIVE_LOANS" }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.libraryBook.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date(), updatedById: user.userId } });
    await recordLibraryHistory(tx, {
      schoolId,
      event: "BOOK_ARCHIVED",
      bookId: id,
      previousStatus: book.status,
      newStatus: "ARCHIVED",
      actorId: user.userId,
      actorRole: user.role,
    });
  });

  await logAudit({
    action: "LIBRARY_BOOK_ARCHIVED",
    entityType: "LibraryBook",
    entityId: id,
    userId: user.userId,
    schoolId,
    actorRole: user.role,
  });

  return NextResponse.json({ ok: true });
}
