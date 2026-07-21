import { Prisma } from "@/generated/prisma/client";
import type { LibraryBook, LibraryBookCopy, LibraryLoan, LibraryReservation } from "@/generated/prisma/client";
import { overdueDays as computeOverdueDays, isOverdue } from "@/lib/library/fines";

/**
 * Public DTO builders. They deliberately strip internal/audit fields and NEVER
 * expose a raw StoredFile.storageKey — only the coverFileId, which resolves
 * through the guarded /api/files/[fileId] route. Borrower identity on
 * reservations is never cross-exposed (see serializeReservationPublic).
 */

export function serializeBook(book: LibraryBook & { copies?: LibraryBookCopy[]; _count?: { copies: number } }) {
  const copies = book.copies ?? [];
  const availableCopies = copies.filter((c) => c.status === "AVAILABLE").length;
  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors,
    isbn10: book.isbn10,
    isbn13: book.isbn13,
    publisher: book.publisher,
    edition: book.edition,
    publicationYear: book.publicationYear,
    language: book.language,
    category: book.category,
    subject: book.subject,
    description: book.description,
    coverFileId: book.coverFileId,
    status: book.status,
    archivedAt: book.archivedAt,
    totalCopies: book._count?.copies ?? copies.length,
    availableCopies: book.copies ? availableCopies : undefined,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

export function serializeCopy(copy: LibraryBookCopy) {
  return {
    id: copy.id,
    bookId: copy.bookId,
    accessionNumber: copy.accessionNumber,
    barcode: copy.barcode,
    shelfLocation: copy.shelfLocation,
    acquisitionDate: copy.acquisitionDate,
    acquisitionCost: copy.acquisitionCost ? copy.acquisitionCost.toFixed(2) : null,
    condition: copy.condition,
    status: copy.status,
    statusReason: copy.statusReason,
    statusChangedAt: copy.statusChangedAt,
    createdAt: copy.createdAt,
    updatedAt: copy.updatedAt,
  };
}

export function serializeLoan(
  loan: LibraryLoan & { bookCopy?: (LibraryBookCopy & { book?: LibraryBook | null }) | null },
  opts: { timezone: string; now?: Date }
) {
  const now = opts.now ?? new Date();
  const active = loan.status === "ACTIVE";
  const overdue = active && isOverdue(loan.dueAt, now, opts.timezone);
  const daysOverdue = active ? computeOverdueDays(loan.dueAt, now, opts.timezone) : 0;
  const outstandingFine = new Prisma.Decimal(loan.fineAssessed).minus(loan.fineWaived);
  return {
    id: loan.id,
    status: loan.status,
    bookCopyId: loan.bookCopyId,
    accessionNumber: loan.bookCopy?.accessionNumber ?? null,
    bookId: loan.bookCopy?.bookId ?? null,
    bookTitle: loan.bookCopy?.book?.title ?? null,
    borrowerType: loan.studentId ? "STUDENT" : "TEACHER",
    borrowerId: loan.studentId ?? loan.teacherId,
    issuedAt: loan.issuedAt,
    dueAt: loan.dueAt,
    returnedAt: loan.returnedAt,
    renewalCount: loan.renewalCount,
    finalCondition: loan.finalCondition,
    overdue,
    daysOverdue,
    fineAssessed: new Prisma.Decimal(loan.fineAssessed).toFixed(2),
    fineWaived: new Prisma.Decimal(loan.fineWaived).toFixed(2),
    fineOutstanding: outstandingFine.toFixed(2),
    fineWaivedReason: loan.fineWaivedReason,
    fineWaivedAt: loan.fineWaivedAt,
    createdAt: loan.createdAt,
  };
}

/**
 * Reservation DTO for the OWNER (borrower/parent/staff). Includes queuePosition
 * but never any other borrower's identity.
 */
export function serializeReservationPublic(
  reservation: LibraryReservation & { book?: LibraryBook | null },
  opts: { queuePosition?: number; now?: Date }
) {
  const now = opts.now ?? new Date();
  const expired = reservation.status === "PENDING" && !!reservation.expiresAt && reservation.expiresAt.getTime() < now.getTime();
  return {
    id: reservation.id,
    status: expired ? "EXPIRED" : reservation.status,
    bookId: reservation.bookId,
    bookTitle: reservation.book?.title ?? null,
    requestedAt: reservation.requestedAt,
    fulfilledAt: reservation.fulfilledAt,
    cancelledAt: reservation.cancelledAt,
    cancelReason: reservation.cancelReason,
    expiresAt: reservation.expiresAt,
    queuePosition: opts.queuePosition ?? null,
    ready: reservation.status === "PENDING" && !!reservation.allocatedCopyId && !expired,
  };
}

/** Staff reservation DTO — adds borrower identity (staff are authorized to see it). */
export function serializeReservationStaff(
  reservation: LibraryReservation & { book?: LibraryBook | null },
  opts: { queuePosition?: number; now?: Date }
) {
  return {
    ...serializeReservationPublic(reservation, opts),
    borrowerType: reservation.studentId ? "STUDENT" : "TEACHER",
    borrowerId: reservation.studentId ?? reservation.teacherId,
    allocatedCopyId: reservation.allocatedCopyId,
  };
}
