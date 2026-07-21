import { prisma } from "@/lib/prisma";
import { parsePagination, paginated, type Paginated } from "@/lib/pagination";
import { serializeBook } from "@/lib/library/serializers";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Shared read-only catalogue listing for the self-service portals (student /
 * teacher / parent). Only ACTIVE titles, availability computed from copy status.
 * Tenant-scoped by the caller-supplied (server-derived) schoolId.
 */
export async function listCatalogue(
  schoolId: string,
  searchParams: URLSearchParams
): Promise<Paginated<ReturnType<typeof serializeBook>>> {
  const pagination = parsePagination(searchParams);
  const q = searchParams.get("q")?.trim();
  const category = searchParams.get("category")?.trim();
  const subject = searchParams.get("subject")?.trim();

  const where: Prisma.LibraryBookWhereInput = { schoolId, status: "ACTIVE" };
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
      include: { copies: true },
    }),
    prisma.libraryBook.count({ where }),
  ]);

  return paginated(rows.map((b) => serializeBook(b)), total, pagination);
}
