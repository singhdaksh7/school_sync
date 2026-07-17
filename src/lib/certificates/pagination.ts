/**
 * Deterministic cursor pagination for Certificates list endpoints (spec
 * §12). The repo's existing src/lib/pagination.ts is offset-based
 * (page/limit) — certificates use a cursor instead so a page boundary never
 * shifts while new requests are being created concurrently. Cursor is an
 * opaque base64url-encoded `${createdAt.toISOString()}|${id}` pair; ordering
 * is always `createdAt desc, id desc` so the tiebreaker is stable even when
 * two rows share the same millisecond timestamp.
 */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [iso, id] = raw.split("|");
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function clampLimit(raw: number | undefined): number {
  if (!raw || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(raw)), MAX_LIMIT);
}

/** Prisma `where` fragment implementing `(createdAt, id) < (cursor.createdAt, cursor.id)` for desc ordering. */
export function cursorWhereBefore(cursor: { createdAt: Date; id: string } | null) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function buildCursorPage<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;
  return { page, nextCursor };
}
