import { Prisma, type LibraryHistoryEvent, type LibraryBorrowerType } from "@/generated/prisma/client";
import type { AuditAction } from "@/lib/audit";

export type LibraryHistoryEntry = {
  schoolId: string;
  event: LibraryHistoryEvent;
  bookId?: string | null;
  copyId?: string | null;
  loanId?: string | null;
  reservationId?: string | null;
  borrowerType?: LibraryBorrowerType | null;
  borrowerId?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  fineAmount?: Prisma.Decimal | null;
  dueAtBefore?: Date | null;
  dueAtAfter?: Date | null;
  reason?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
};

/**
 * Appends one domain-typed row to LibraryHistory using the SAME
 * transaction client as the state change, so history is atomic with the event
 * it records (never a half-written audit trail). AuditLog (generic) is written
 * separately by the caller after commit (best-effort, see src/lib/audit.ts).
 */
export async function recordLibraryHistory(
  client: Prisma.TransactionClient,
  entry: LibraryHistoryEntry
) {
  return client.libraryHistory.create({
    data: {
      schoolId: entry.schoolId,
      event: entry.event,
      bookId: entry.bookId ?? null,
      copyId: entry.copyId ?? null,
      loanId: entry.loanId ?? null,
      reservationId: entry.reservationId ?? null,
      borrowerType: entry.borrowerType ?? null,
      borrowerId: entry.borrowerId ?? null,
      previousStatus: entry.previousStatus ?? null,
      newStatus: entry.newStatus ?? null,
      fineAmount: entry.fineAmount ?? null,
      dueAtBefore: entry.dueAtBefore ?? null,
      dueAtAfter: entry.dueAtAfter ?? null,
      reason: entry.reason ?? null,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
    },
  });
}

/** Maps a domain history event to its generic AuditLog action. */
export const LIBRARY_EVENT_AUDIT_ACTION: Record<LibraryHistoryEvent, AuditAction> = {
  BOOK_CREATED: "LIBRARY_BOOK_CREATED",
  BOOK_UPDATED: "LIBRARY_BOOK_UPDATED",
  BOOK_ARCHIVED: "LIBRARY_BOOK_ARCHIVED",
  BOOK_RESTORED: "LIBRARY_BOOK_RESTORED",
  COPY_ADDED: "LIBRARY_COPY_ADDED",
  COPY_STATUS_CHANGED: "LIBRARY_COPY_STATUS_CHANGED",
  BOOK_ISSUED: "LIBRARY_BOOK_ISSUED",
  BOOK_RETURNED: "LIBRARY_BOOK_RETURNED",
  LOAN_RENEWED: "LIBRARY_LOAN_RENEWED",
  RESERVATION_CREATED: "LIBRARY_RESERVATION_CREATED",
  RESERVATION_CANCELLED: "LIBRARY_RESERVATION_CANCELLED",
  RESERVATION_FULFILLED: "LIBRARY_RESERVATION_FULFILLED",
  RESERVATION_EXPIRED: "LIBRARY_RESERVATION_EXPIRED",
  FINE_ASSESSED: "LIBRARY_FINE_ASSESSED",
  FINE_WAIVED: "LIBRARY_FINE_WAIVED",
  POLICY_CHANGED: "LIBRARY_POLICY_CHANGED",
};
