/**
 * Central pagination contract for list endpoints.
 *
 * Request:  ?page=1&limit=50
 * Response: { data: [...], pagination: { page, limit, total, totalPages,
 *                                        hasNextPage, hasPreviousPage } }
 *
 * Clients cannot request unbounded pages — `limit` is clamped to [1, MAX_LIMIT]
 * and `page` to >= 1. Endpoints must still apply a STABLE ordering and keep the
 * tenant scope in their `where` clause.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export type PaginationParams = { page: number; limit: number; skip: number; take: number };

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type Paginated<T> = { data: T[]; pagination: PaginationMeta };

function toPositiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parses & clamps page/limit from a URLSearchParams into Prisma skip/take. */
export function parsePagination(
  searchParams: URLSearchParams,
  opts: { defaultLimit?: number; maxLimit?: number } = {}
): PaginationParams {
  const maxLimit = opts.maxLimit ?? MAX_LIMIT;
  const defaultLimit = Math.min(opts.defaultLimit ?? DEFAULT_LIMIT, maxLimit);
  const page = Math.max(1, toPositiveInt(searchParams.get("page"), DEFAULT_PAGE));
  const rawLimit = toPositiveInt(searchParams.get("limit"), defaultLimit);
  const limit = Math.min(Math.max(1, rawLimit), maxLimit);
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const safeTotal = Math.max(0, total);
  const totalPages = limit > 0 ? Math.ceil(safeTotal / limit) : 0;
  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && safeTotal > 0,
  };
}

export function paginated<T>(data: T[], total: number, params: PaginationParams): Paginated<T> {
  return { data, pagination: buildPaginationMeta(total, params.page, params.limit) };
}
