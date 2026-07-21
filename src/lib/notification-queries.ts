/**
 * Unified Notification Center v1 — read/query service layer (list, unread
 * count, mark-read, mark-all-read). Every function here takes the
 * AUTHENTICATED recipient as an explicit argument and scopes the underlying
 * Prisma query by it directly (never "fetch then check in application code")
 * — see each function for exactly which column is filtered.
 *
 * Pagination is cursor-based (opaque, encoding the stable
 * (createdAt, id) DESC tiebreak already used elsewhere in this codebase —
 * see announcements.ts/jobs.ts's `orderBy: [{...}, {id: "desc"}]` idiom) —
 * NOT the repository's existing offset `parsePagination`/`paginated` helper,
 * which degrades under concurrent inserts into a high-volume, real-time-
 * appended feed like this one.
 */
import { prisma } from "@/lib/prisma";
import type { NotificationEventType, NotificationRecipientType } from "@/generated/prisma/client";

export interface RecipientRef {
  recipientType: NotificationRecipientType;
  recipientId: string;
}

export interface NotificationDTO {
  id: string;
  eventType: NotificationEventType;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function recipientWhere(recipient: RecipientRef): Record<string, string> {
  switch (recipient.recipientType) {
    case "STUDENT":
      return { studentId: recipient.recipientId };
    case "GUARDIAN":
      return { guardianId: recipient.recipientId };
    case "TEACHER":
      return { teacherId: recipient.recipientId };
    case "ADMIN_STAFF":
      return { userId: recipient.recipientId };
  }
}

/** Opaque cursor encoding (createdAt, id) — the same stable DESC tiebreak used to order the feed. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep < 0) return null;
    const createdAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function toDTO(row: {
  id: string; eventType: NotificationEventType; entityType: string; entityId: string;
  metadata: unknown; createdAt: Date; readAt: Date | null; archivedAt: Date | null;
}): NotificationDTO {
  return {
    id: row.id,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

export interface ListNotificationsArgs {
  schoolId: string;
  recipient: RecipientRef;
  unreadOnly?: boolean;
  cursor?: string | null;
  limit?: number;
}

export interface ListNotificationsResult {
  items: NotificationDTO[];
  nextCursor: string | null;
}

/** Cursor-paginated, newest-first. Never includes archived notifications. */
export async function listNotificationsForRecipient(args: ListNotificationsArgs): Promise<ListNotificationsResult> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const decodedCursor = args.cursor ? decodeCursor(args.cursor) : null;
  if (args.cursor && !decodedCursor) return { items: [], nextCursor: null }; // malformed cursor: safe empty page, not an error

  const where: Record<string, unknown> = {
    schoolId: args.schoolId,
    recipientType: args.recipient.recipientType,
    ...recipientWhere(args.recipient),
    archivedAt: null,
    ...(args.unreadOnly ? { readAt: null } : {}),
    ...(decodedCursor
      ? {
          OR: [
            { createdAt: { lt: decodedCursor.createdAt } },
            { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } },
          ],
        }
      : {}),
  };

  const rows = await prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, eventType: true, entityType: true, entityId: true, metadata: true, createdAt: true, readAt: true, archivedAt: true },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(toDTO),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function unreadNotificationCount(schoolId: string, recipient: RecipientRef): Promise<number> {
  return prisma.notification.count({
    where: { schoolId, recipientType: recipient.recipientType, ...recipientWhere(recipient), archivedAt: null, readAt: null },
  });
}

export type MarkReadResult = { ok: true } | { ok: false; code: "NOT_FOUND" };

/**
 * Marks ONE notification read. The scoping (schoolId + recipient columns) is
 * part of the UPDATE's WHERE clause itself — a foreign/cross-tenant/
 * unauthorized notification id can never be marked read via this function,
 * and the caller cannot learn whether it exists (NOT_FOUND either way).
 * Idempotent: marking an already-read notification read again is a safe
 * no-op that still returns ok:true (never surfaces the read/unread history
 * as an error).
 */
export async function markNotificationRead(schoolId: string, recipient: RecipientRef, notificationId: string): Promise<MarkReadResult> {
  const scope = { id: notificationId, schoolId, recipientType: recipient.recipientType, ...recipientWhere(recipient) };
  const updated = await prisma.notification.updateMany({ where: { ...scope, readAt: null }, data: { readAt: new Date() } });
  if (updated.count === 1) return { ok: true };
  // Either already read, or genuinely not this recipient's/school's row —
  // re-check existence within the SAME scope to distinguish idempotent
  // success from a real NOT_FOUND, without ever loosening the scope.
  const stillExists = await prisma.notification.findFirst({ where: scope, select: { id: true } });
  return stillExists ? { ok: true } : { ok: false, code: "NOT_FOUND" };
}

/** Marks every currently-unread notification for this recipient read in one scoped update. */
export async function markAllNotificationsRead(schoolId: string, recipient: RecipientRef): Promise<{ count: number }> {
  const result = await prisma.notification.updateMany({
    where: { schoolId, recipientType: recipient.recipientType, ...recipientWhere(recipient), readAt: null },
    data: { readAt: new Date() },
  });
  return { count: result.count };
}
