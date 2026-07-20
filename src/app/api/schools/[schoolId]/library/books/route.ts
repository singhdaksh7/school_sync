import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead, requireLibraryCatalogueManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, unauthorized } from "@/lib/library/http";
import { parsePagination, paginated } from "@/lib/pagination";
import { serializeBook } from "@/lib/library/serializers";
import { logAudit } from "@/lib/audit";
import { recordLibraryHistory } from "@/lib/library/history";
import type { Prisma } from "@/generated/prisma/client";

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(300).optional(),
  authors: z.string().trim().max(500).optional(),
  isbn10: z.string().trim().max(20).optional(),
  isbn13: z.string().trim().max(20).optional(),
  publisher: z.string().trim().max(200).optional(),
  edition: z.string().trim().max(100).optional(),
  publicationYear: z.number().int().min(0).max(3000).optional(),
  language: z.string().trim().max(60).optional(),
  category: z.string().trim().max(120).optional(),
  subject: z.string().trim().max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  coverFileId: z.string().trim().optional(),
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
  const q = url.searchParams.get("q")?.trim();
  const category = url.searchParams.get("category")?.trim();
  const subject = url.searchParams.get("subject")?.trim();
  const status = url.searchParams.get("status")?.trim();

  const where: Prisma.LibraryBookWhereInput = { schoolId };
  if (status === "ACTIVE" || status === "ARCHIVED") where.status = status;
  if (category) where.category = { equals: category, mode: "insensitive" };
  if (subject) where.subject = { equals: subject, mode: "insensitive" };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { authors: { contains: q, mode: "insensitive" } },
      { isbn10: { contains: q, mode: "insensitive" } },
      { isbn13: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.libraryBook.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { copies: true } } },
    }),
    prisma.libraryBook.count({ where }),
  ]);

  return NextResponse.json(paginated(rows.map((b) => serializeBook(b)), total, pagination));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryCatalogueManage(schoolId, user.userId);
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

  // Reject cross-tenant cover file references.
  if (body.coverFileId) {
    const file = await prisma.storedFile.findFirst({
      where: { id: body.coverFileId, schoolId, category: "LIBRARY_BOOK_COVER", deletedAt: null },
      select: { id: true },
    });
    if (!file) return NextResponse.json({ error: "Invalid cover file" }, { status: 400 });
  }

  const book = await prisma.$transaction(async (tx) => {
    const created = await tx.libraryBook.create({
      data: {
        schoolId,
        title: body.title,
        subtitle: body.subtitle ?? null,
        authors: body.authors ?? null,
        isbn10: body.isbn10 ?? null,
        isbn13: body.isbn13 ?? null,
        publisher: body.publisher ?? null,
        edition: body.edition ?? null,
        publicationYear: body.publicationYear ?? null,
        language: body.language ?? null,
        category: body.category ?? null,
        subject: body.subject ?? null,
        description: body.description ?? null,
        coverFileId: body.coverFileId ?? null,
        createdById: user.userId,
        updatedById: user.userId,
      },
    });
    await recordLibraryHistory(tx, {
      schoolId,
      event: "BOOK_CREATED",
      bookId: created.id,
      newStatus: created.status,
      actorId: user.userId,
      actorRole: user.role,
    });
    return created;
  });

  await logAudit({
    action: "LIBRARY_BOOK_CREATED",
    entityType: "LibraryBook",
    entityId: book.id,
    userId: user.userId,
    schoolId,
    actorRole: user.role,
    metadata: { title: book.title },
  });

  return NextResponse.json(serializeBook(book), { status: 201 });
}
