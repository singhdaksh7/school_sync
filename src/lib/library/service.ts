import { Prisma, type LibraryBorrowerType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getEffectiveLibraryPolicy, borrowLimitFor, loanDurationDaysFor } from "@/lib/library/policy";
import { computeFine, isOverdue } from "@/lib/library/fines";
import { recordLibraryHistory, LIBRARY_EVENT_AUDIT_ACTION } from "@/lib/library/history";
import { emitLibraryEvent } from "@/lib/library/events";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Borrower = { type: LibraryBorrowerType; id: string };
export type ServiceActor = { userId: string; role: string };

export type ServiceError = { ok: false; code: string; status: number; message: string };
export type ServiceOk<T> = { ok: true; data: T };
export type ServiceResult<T> = ServiceOk<T> | ServiceError;

function err(code: string, status: number, message: string): ServiceError {
  return { ok: false, code, status, message };
}

function borrowerWhere(borrower: Borrower) {
  return borrower.type === "STUDENT"
    ? { studentId: borrower.id, teacherId: null }
    : { teacherId: borrower.id, studentId: null };
}

function matchesBorrower(row: { studentId: string | null; teacherId: string | null }, borrower: Borrower) {
  return borrower.type === "STUDENT" ? row.studentId === borrower.id : row.teacherId === borrower.id;
}

async function borrowerExists(
  tx: Prisma.TransactionClient,
  schoolId: string,
  borrower: Borrower
): Promise<boolean> {
  if (borrower.type === "STUDENT") {
    const s = await tx.student.findFirst({ where: { id: borrower.id, schoolId }, select: { id: true } });
    return Boolean(s);
  }
  const t = await tx.teacher.findFirst({ where: { id: borrower.id, schoolId, isDeleted: false }, select: { id: true } });
  return Boolean(t);
}

/** True when a still-live (non-expired) PENDING reservation should count. */
function reservationIsLive(r: { expiresAt: Date | null }, now: Date): boolean {
  return !r.expiresAt || r.expiresAt.getTime() > now.getTime();
}

/**
 * Promotes the next FIFO-eligible PENDING reservation for (schoolId, bookId) to
 * hold a just-freed `copyId` — called when a copy becomes AVAILABLE again via
 * return or reservation cancellation. Race-safety:
 *  - Row-locks the copy (FOR UPDATE) so this promotion serializes against
 *    issueLoan and any other concurrent promotion targeting the SAME copy;
 *    re-checks the copy is still AVAILABLE under the lock (a no-op, returning
 *    null, if something else already claimed it).
 *  - Selects candidates ordered by requestedAt then id (stable tie-break) so
 *    FIFO order is deterministic even when two reservations share a timestamp.
 *  - Only considers PENDING, live (non-expired), not-already-holding-a-copy
 *    reservations, and skips (without mutating) any whose borrower no longer
 *    exists — an orphaned reservation is left for a separate cleanup pass
 *    rather than silently allocated to a borrower who can't use it.
 *  - Claims the winning candidate via a conditional updateMany scoped to
 *    (status: PENDING, allocatedCopyId: null); a losing concurrent promotion
 *    for a DIFFERENT freed copy racing on the same front-of-queue reservation
 *    sees 0 rows affected and falls through to the next candidate — so two
 *    reservations can never be awarded the same copy, and one reservation can
 *    never be awarded two copies.
 * Returns the promoted reservation's id/borrower, or null when nothing was
 * promoted (empty/exhausted queue, or the copy was no longer AVAILABLE).
 */
async function promoteReservationQueue(
  tx: Prisma.TransactionClient,
  args: {
    schoolId: string;
    bookId: string;
    copyId: string;
    reservationHoldDurationDays: number;
    now: Date;
    actor: ServiceActor;
  }
): Promise<{ reservationId: string; borrower: Borrower } | null> {
  const locked = await tx.$queryRaw<{ id: string; status: string }[]>(
    Prisma.sql`SELECT "id", "status" FROM "LibraryBookCopy" WHERE "id" = ${args.copyId} AND "schoolId" = ${args.schoolId} FOR UPDATE`
  );
  if (locked.length === 0 || locked[0].status !== "AVAILABLE") return null;

  const candidates = await tx.libraryReservation.findMany({
    where: { schoolId: args.schoolId, bookId: args.bookId, status: "PENDING", allocatedCopyId: null },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
  });

  for (const candidate of candidates) {
    if (!reservationIsLive(candidate, args.now)) continue;
    const borrower: Borrower = candidate.studentId
      ? { type: "STUDENT", id: candidate.studentId }
      : { type: "TEACHER", id: candidate.teacherId! };
    if (!(await borrowerExists(tx, args.schoolId, borrower))) continue;

    const holdUntil = new Date(args.now.getTime() + args.reservationHoldDurationDays * DAY_MS);
    const claim = await tx.libraryReservation.updateMany({
      where: { id: candidate.id, status: "PENDING", allocatedCopyId: null },
      data: { allocatedCopyId: args.copyId, expiresAt: holdUntil },
    });
    if (claim.count === 0) continue;

    const copyUpd = await tx.libraryBookCopy.updateMany({
      where: { id: args.copyId, status: "AVAILABLE" },
      data: { status: "RESERVED" },
    });
    if (copyUpd.count === 0) {
      // Impossible while the FOR UPDATE lock above is held for this
      // transaction's lifetime; fail loud rather than leave a reservation
      // holding a copy whose status never actually flipped.
      throw new Error("Copy status changed unexpectedly while locked for reservation promotion");
    }

    await recordLibraryHistory(tx, {
      schoolId: args.schoolId,
      event: "COPY_STATUS_CHANGED",
      reservationId: candidate.id,
      bookId: args.bookId,
      copyId: args.copyId,
      previousStatus: "AVAILABLE",
      newStatus: "RESERVED",
      borrowerType: borrower.type,
      borrowerId: borrower.id,
      actorId: args.actor.userId,
      actorRole: args.actor.role,
    });

    return { reservationId: candidate.id, borrower };
  }
  return null;
}

// ─── Issue ───────────────────────────────────────────────────────────────────

export type IssueResult = { loanId: string; dueAt: Date; copyId: string; fulfilledReservationId: string | null };

export async function issueLoan(args: {
  schoolId: string;
  copyId: string;
  borrower: Borrower;
  actor: ServiceActor;
  timezone: string;
  now?: Date;
}): Promise<ServiceResult<IssueResult>> {
  const now = args.now ?? new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row-lock the copy so concurrent issues on the same copy serialize; the
      // partial unique index is the final backstop if two ever slip through.
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "LibraryBookCopy" WHERE "id" = ${args.copyId} AND "schoolId" = ${args.schoolId} FOR UPDATE`
      );
      if (locked.length === 0) return err("NOT_FOUND", 404, "Copy not found");

      const copy = await tx.libraryBookCopy.findUnique({ where: { id: args.copyId } });
      if (!copy || copy.schoolId !== args.schoolId) return err("NOT_FOUND", 404, "Copy not found");

      if (!(await borrowerExists(tx, args.schoolId, args.borrower))) {
        return err("BORROWER_NOT_FOUND", 404, "Borrower not found");
      }

      const policy = await getEffectiveLibraryPolicy(args.schoolId, tx);

      // Copy must be issuable.
      if (copy.status !== "AVAILABLE" && copy.status !== "RESERVED") {
        return err("COPY_NOT_AVAILABLE", 409, "Copy is not available for issue");
      }

      // Reservation FIFO priority: gather live PENDING reservations for this title.
      const pending = await tx.libraryReservation.findMany({
        where: { schoolId: args.schoolId, bookId: copy.bookId, status: "PENDING" },
        orderBy: { requestedAt: "asc" },
      });
      const livePending = pending.filter((r) => reservationIsLive(r, now));
      const myReservation = livePending.find((r) => matchesBorrower(r, args.borrower)) ?? null;
      const othersAhead = livePending.filter((r) => !matchesBorrower(r, args.borrower));

      if (copy.status === "RESERVED") {
        // A held copy may only be issued to the borrower it is allocated for (or
        // the front-of-queue borrower for this title).
        const allocatedFor = livePending.find((r) => r.allocatedCopyId === copy.id) ?? livePending[0] ?? null;
        if (!allocatedFor || !matchesBorrower(allocatedFor, args.borrower)) {
          return err("RESERVED_FOR_OTHER", 409, "Copy is reserved for another borrower");
        }
      } else {
        // AVAILABLE copy: block only when the reservation queue ahead of this
        // walk-in would consume all currently-available copies.
        if (!myReservation && othersAhead.length > 0) {
          const availableCount = await tx.libraryBookCopy.count({
            where: { schoolId: args.schoolId, bookId: copy.bookId, status: "AVAILABLE" },
          });
          if (othersAhead.length >= availableCount) {
            return err("RESERVED_FOR_OTHER", 409, "All available copies are reserved");
          }
        }
      }

      // Borrowing limit.
      const activeCount = await tx.libraryLoan.count({
        where: { schoolId: args.schoolId, status: "ACTIVE", ...borrowerWhere(args.borrower) },
      });
      if (activeCount >= borrowLimitFor(policy, args.borrower.type)) {
        return err("LIMIT_EXCEEDED", 409, "Borrowing limit reached");
      }

      // Blocking overdue.
      if (policy.blockBorrowingIfOverdue) {
        const activeLoans = await tx.libraryLoan.findMany({
          where: { schoolId: args.schoolId, status: "ACTIVE", ...borrowerWhere(args.borrower) },
          select: { dueAt: true },
        });
        const hasOverdue = activeLoans.some((l) => isOverdue(l.dueAt, now, args.timezone));
        if (hasOverdue) return err("BLOCKED_OVERDUE", 409, "Borrower has an overdue loan");
      }

      const durationDays = loanDurationDaysFor(policy, args.borrower.type);
      const dueAt = new Date(now.getTime() + durationDays * DAY_MS);

      const loan = await tx.libraryLoan.create({
        data: {
          schoolId: args.schoolId,
          bookCopyId: copy.id,
          ...borrowerWhere(args.borrower),
          status: "ACTIVE",
          issuedById: args.actor.userId,
          issuedAt: now,
          dueAt,
        },
      });

      await tx.libraryBookCopy.update({ where: { id: copy.id }, data: { status: "ISSUED" } });

      let fulfilledReservationId: string | null = null;
      if (myReservation) {
        const upd = await tx.libraryReservation.updateMany({
          where: { id: myReservation.id, status: "PENDING" },
          data: { status: "FULFILLED", fulfilledAt: now, allocatedCopyId: copy.id },
        });
        if (upd.count > 0) {
          fulfilledReservationId = myReservation.id;
          await recordLibraryHistory(tx, {
            schoolId: args.schoolId,
            event: "RESERVATION_FULFILLED",
            reservationId: myReservation.id,
            bookId: copy.bookId,
            copyId: copy.id,
            borrowerType: args.borrower.type,
            borrowerId: args.borrower.id,
            actorId: args.actor.userId,
            actorRole: args.actor.role,
          });
        }
      }

      await recordLibraryHistory(tx, {
        schoolId: args.schoolId,
        event: "BOOK_ISSUED",
        loanId: loan.id,
        bookId: copy.bookId,
        copyId: copy.id,
        borrowerType: args.borrower.type,
        borrowerId: args.borrower.id,
        dueAtAfter: dueAt,
        actorId: args.actor.userId,
        actorRole: args.actor.role,
      });

      return { ok: true as const, data: { loanId: loan.id, dueAt, copyId: copy.id, fulfilledReservationId } };
    });

    if (result.ok) {
      await logAudit({
        action: LIBRARY_EVENT_AUDIT_ACTION.BOOK_ISSUED,
        entityType: "LibraryLoan",
        entityId: result.data.loanId,
        userId: args.actor.userId,
        schoolId: args.schoolId,
        actorRole: args.actor.role,
        metadata: { copyId: result.data.copyId, borrowerType: args.borrower.type },
      });
      emitLibraryEvent({
        type: "BOOK_ISSUED",
        schoolId: args.schoolId,
        loanId: result.data.loanId,
        copyId: result.data.copyId,
        borrowerType: args.borrower.type,
        borrowerId: args.borrower.id,
        dueAt: result.data.dueAt,
      });
    }
    return result;
  } catch (e) {
    // Partial unique index (active loan per copy) — concurrent double-issue.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err("COPY_NOT_AVAILABLE", 409, "Copy was just issued by another request");
    }
    throw e;
  }
}

// ─── Return ────────────────────────────────────────────────────────────────

export type ReturnResult = { loanId: string; fineAssessed: string; overdue: boolean; copyStatus: string };
export type ReturnCopyOutcome = "AVAILABLE" | "LOST" | "DAMAGED" | "UNDER_REPAIR";

export async function returnLoan(args: {
  schoolId: string;
  loanId: string;
  actor: ServiceActor;
  timezone: string;
  finalCondition?: string | null;
  copyOutcome?: ReturnCopyOutcome;
  now?: Date;
}): Promise<ServiceResult<ReturnResult>> {
  const now = args.now ?? new Date();
  const outcome = args.copyOutcome ?? "AVAILABLE";
  const result = await prisma.$transaction(async (tx) => {
    const loan = await tx.libraryLoan.findFirst({ where: { id: args.loanId, schoolId: args.schoolId } });
    if (!loan) return err("NOT_FOUND", 404, "Loan not found");
    if (loan.status !== "ACTIVE") return err("ALREADY_RETURNED", 409, "Loan is not active");

    const policy = await getEffectiveLibraryPolicy(args.schoolId, tx);
    const fine = computeFine(loan.dueAt, now, args.timezone, policy);
    const overdue = isOverdue(loan.dueAt, now, args.timezone);

    // Idempotent conditional close: only the txn that flips ACTIVE->RETURNED wins.
    const upd = await tx.libraryLoan.updateMany({
      where: { id: loan.id, status: "ACTIVE" },
      data: {
        status: outcome === "LOST" ? "LOST" : "RETURNED",
        returnedAt: now,
        receivedById: args.actor.userId,
        finalCondition: args.finalCondition ?? null,
        fineAssessed: fine,
      },
    });
    if (upd.count === 0) return err("ALREADY_RETURNED", 409, "Loan was already returned");

    // Copy destination status.
    const copyStatus = outcome === "AVAILABLE" ? "AVAILABLE" : outcome;
    await tx.libraryBookCopy.update({ where: { id: loan.bookCopyId }, data: { status: copyStatus } });

    // Allocate the freed copy to the next FIFO-eligible reservation (hold it).
    let allocatedReservationId: string | null = null;
    if (copyStatus === "AVAILABLE") {
      const copy = await tx.libraryBookCopy.findUnique({ where: { id: loan.bookCopyId }, select: { bookId: true } });
      const promoted = copy
        ? await promoteReservationQueue(tx, {
            schoolId: args.schoolId,
            bookId: copy.bookId,
            copyId: loan.bookCopyId,
            reservationHoldDurationDays: policy.reservationHoldDurationDays,
            now,
            actor: args.actor,
          })
        : null;
      allocatedReservationId = promoted?.reservationId ?? null;
    }

    await recordLibraryHistory(tx, {
      schoolId: args.schoolId,
      event: "BOOK_RETURNED",
      loanId: loan.id,
      copyId: loan.bookCopyId,
      borrowerType: loan.studentId ? "STUDENT" : "TEACHER",
      borrowerId: loan.studentId ?? loan.teacherId,
      newStatus: copyStatus,
      fineAmount: fine,
      actorId: args.actor.userId,
      actorRole: args.actor.role,
    });
    if (fine.greaterThan(0)) {
      await recordLibraryHistory(tx, {
        schoolId: args.schoolId,
        event: "FINE_ASSESSED",
        loanId: loan.id,
        borrowerType: loan.studentId ? "STUDENT" : "TEACHER",
        borrowerId: loan.studentId ?? loan.teacherId,
        fineAmount: fine,
        actorId: args.actor.userId,
        actorRole: args.actor.role,
      });
    }

    return {
      ok: true as const,
      data: {
        loanId: loan.id,
        fineAssessed: fine.toFixed(2),
        overdue,
        copyStatus: allocatedReservationId ? "RESERVED" : copyStatus,
        borrower: { type: loan.studentId ? "STUDENT" : ("TEACHER" as LibraryBorrowerType), id: (loan.studentId ?? loan.teacherId)! },
      },
    };
  });

  if (result.ok) {
    await logAudit({
      action: LIBRARY_EVENT_AUDIT_ACTION.BOOK_RETURNED,
      entityType: "LibraryLoan",
      entityId: result.data.loanId,
      userId: args.actor.userId,
      schoolId: args.schoolId,
      actorRole: args.actor.role,
      metadata: { fineAssessed: result.data.fineAssessed, overdue: result.data.overdue },
    });
    if (Number(result.data.fineAssessed) > 0) {
      await logAudit({
        action: LIBRARY_EVENT_AUDIT_ACTION.FINE_ASSESSED,
        entityType: "LibraryLoan",
        entityId: result.data.loanId,
        userId: args.actor.userId,
        schoolId: args.schoolId,
        actorRole: args.actor.role,
        metadata: { amount: result.data.fineAssessed },
      });
      emitLibraryEvent({
        type: "FINE_ASSESSED",
        schoolId: args.schoolId,
        loanId: result.data.loanId,
        borrowerType: result.data.borrower.type,
        borrowerId: result.data.borrower.id,
        amount: result.data.fineAssessed,
      });
    }
    return { ok: true, data: { loanId: result.data.loanId, fineAssessed: result.data.fineAssessed, overdue: result.data.overdue, copyStatus: result.data.copyStatus } };
  }
  return result;
}

// ─── Renew ────────────────────────────────────────────────────────────────

export type RenewResult = { loanId: string; dueAt: Date; renewalCount: number };

export async function renewLoan(args: {
  schoolId: string;
  loanId: string;
  actor: ServiceActor;
  now?: Date;
}): Promise<ServiceResult<RenewResult>> {
  const now = args.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const loan = await tx.libraryLoan.findFirst({ where: { id: args.loanId, schoolId: args.schoolId } });
    if (!loan) return err("NOT_FOUND", 404, "Loan not found");
    if (loan.status !== "ACTIVE") return err("INVALID_STATE", 409, "Loan is not active");

    const policy = await getEffectiveLibraryPolicy(args.schoolId, tx);
    if (loan.renewalCount >= policy.maxRenewals) return err("MAX_RENEWALS", 409, "Renewal limit reached");

    const copy = await tx.libraryBookCopy.findUnique({ where: { id: loan.bookCopyId }, select: { status: true, bookId: true } });
    if (!copy) return err("NOT_FOUND", 404, "Copy not found");
    if (["LOST", "DAMAGED", "WITHDRAWN"].includes(copy.status)) {
      return err("INVALID_STATE", 409, "Copy cannot be renewed in its current state");
    }

    // A pending reservation by anyone else blocks renewal (FIFO priority).
    const borrower: Borrower = loan.studentId
      ? { type: "STUDENT", id: loan.studentId }
      : { type: "TEACHER", id: loan.teacherId! };
    const pending = await tx.libraryReservation.findMany({
      where: { schoolId: args.schoolId, bookId: copy.bookId, status: "PENDING" },
    });
    const conflicting = pending.filter((r) => reservationIsLive(r, now) && !matchesBorrower(r, borrower));
    if (conflicting.length > 0) return err("BLOCKED_RESERVATION", 409, "A reservation is waiting for this title");

    const durationDays = loanDurationDaysFor(policy, borrower.type);
    const newDue = new Date(loan.dueAt.getTime() + durationDays * DAY_MS);

    // Optimistic guard on the CURRENT renewalCount makes a retried call a no-op
    // (a second call sees the incremented count and matches 0 rows).
    const upd = await tx.libraryLoan.updateMany({
      where: { id: loan.id, status: "ACTIVE", renewalCount: loan.renewalCount },
      data: { renewalCount: { increment: 1 }, dueAt: newDue },
    });
    if (upd.count === 0) return err("CONFLICT", 409, "Loan changed concurrently; retry");

    await recordLibraryHistory(tx, {
      schoolId: args.schoolId,
      event: "LOAN_RENEWED",
      loanId: loan.id,
      copyId: loan.bookCopyId,
      borrowerType: borrower.type,
      borrowerId: borrower.id,
      dueAtBefore: loan.dueAt,
      dueAtAfter: newDue,
      actorId: args.actor.userId,
      actorRole: args.actor.role,
    });

    return { ok: true as const, data: { loanId: loan.id, dueAt: newDue, renewalCount: loan.renewalCount + 1 } };
  });

  if (result.ok) {
    await logAudit({
      action: LIBRARY_EVENT_AUDIT_ACTION.LOAN_RENEWED,
      entityType: "LibraryLoan",
      entityId: result.data.loanId,
      userId: args.actor.userId,
      schoolId: args.schoolId,
      actorRole: args.actor.role,
      metadata: { renewalCount: result.data.renewalCount },
    });
  }
  return result;
}

// ─── Fine waiver (full waiver only, mandatory reason) ────────────────────────

export async function waiveFine(args: {
  schoolId: string;
  loanId: string;
  reason: string;
  actor: ServiceActor;
  now?: Date;
}): Promise<ServiceResult<{ loanId: string; waived: string }>> {
  const now = args.now ?? new Date();
  const reason = args.reason.trim();
  if (!reason) return err("REASON_REQUIRED", 400, "A waiver reason is required");

  const result = await prisma.$transaction(async (tx) => {
    const loan = await tx.libraryLoan.findFirst({ where: { id: args.loanId, schoolId: args.schoolId } });
    if (!loan) return err("NOT_FOUND", 404, "Loan not found");

    const outstanding = new Prisma.Decimal(loan.fineAssessed).minus(loan.fineWaived);
    if (outstanding.lessThanOrEqualTo(0)) return err("NOTHING_TO_WAIVE", 409, "No outstanding fine to waive");

    // Full waiver: waived := assessed. Server-computed — any client amount ignored.
    const upd = await tx.libraryLoan.updateMany({
      where: { id: loan.id, fineWaived: loan.fineWaived },
      data: { fineWaived: loan.fineAssessed, fineWaivedReason: reason, fineWaivedById: args.actor.userId, fineWaivedAt: now },
    });
    if (upd.count === 0) return err("CONFLICT", 409, "Fine changed concurrently; retry");

    await recordLibraryHistory(tx, {
      schoolId: args.schoolId,
      event: "FINE_WAIVED",
      loanId: loan.id,
      borrowerType: loan.studentId ? "STUDENT" : "TEACHER",
      borrowerId: loan.studentId ?? loan.teacherId,
      fineAmount: outstanding,
      reason,
      actorId: args.actor.userId,
      actorRole: args.actor.role,
    });

    return { ok: true as const, data: { loanId: loan.id, waived: outstanding.toFixed(2) } };
  });

  if (result.ok) {
    await logAudit({
      action: LIBRARY_EVENT_AUDIT_ACTION.FINE_WAIVED,
      entityType: "LibraryLoan",
      entityId: result.data.loanId,
      userId: args.actor.userId,
      schoolId: args.schoolId,
      actorRole: args.actor.role,
      metadata: { waived: result.data.waived, reason },
    });
  }
  return result;
}

// ─── Reservations ────────────────────────────────────────────────────────────

export async function createReservation(args: {
  schoolId: string;
  bookId: string;
  borrower: Borrower;
  actor: ServiceActor;
  now?: Date;
  /** Set for STUDENT/PARENT actors (no backing User row) — skips the AuditLog
   * write whose userId is a User FK; LibraryHistory (scalar actorId) still records it. */
  skipAudit?: boolean;
}): Promise<ServiceResult<{ reservationId: string; queuePosition: number }>> {
  const now = args.now ?? new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const book = await tx.libraryBook.findFirst({ where: { id: args.bookId, schoolId: args.schoolId } });
      if (!book || book.status !== "ACTIVE") return err("NOT_FOUND", 404, "Book not found");

      const policy = await getEffectiveLibraryPolicy(args.schoolId, tx);
      if (!policy.reservationsEnabled) return err("RESERVATIONS_DISABLED", 409, "Reservations are disabled");

      if (!(await borrowerExists(tx, args.schoolId, args.borrower))) {
        return err("BORROWER_NOT_FOUND", 404, "Borrower not found");
      }

      const existing = await tx.libraryReservation.findFirst({
        where: { schoolId: args.schoolId, bookId: args.bookId, status: "PENDING", ...borrowerWhere(args.borrower) },
        select: { id: true },
      });
      if (existing) return err("DUPLICATE_RESERVATION", 409, "You already have an active reservation for this title");

      const reservation = await tx.libraryReservation.create({
        data: { schoolId: args.schoolId, bookId: args.bookId, status: "PENDING", requestedAt: now, ...borrowerWhere(args.borrower) },
      });

      const ahead = await tx.libraryReservation.count({
        where: { schoolId: args.schoolId, bookId: args.bookId, status: "PENDING", requestedAt: { lt: reservation.requestedAt } },
      });

      await recordLibraryHistory(tx, {
        schoolId: args.schoolId,
        event: "RESERVATION_CREATED",
        reservationId: reservation.id,
        bookId: args.bookId,
        borrowerType: args.borrower.type,
        borrowerId: args.borrower.id,
        actorId: args.actor.userId,
        actorRole: args.actor.role,
      });

      return { ok: true as const, data: { reservationId: reservation.id, queuePosition: ahead + 1 } };
    });

    if (result.ok && !args.skipAudit) {
      await logAudit({
        action: LIBRARY_EVENT_AUDIT_ACTION.RESERVATION_CREATED,
        entityType: "LibraryReservation",
        entityId: result.data.reservationId,
        userId: args.actor.userId,
        schoolId: args.schoolId,
        actorRole: args.actor.role,
        metadata: { bookId: args.bookId, borrowerType: args.borrower.type },
      });
    }
    return result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err("DUPLICATE_RESERVATION", 409, "You already have an active reservation for this title");
    }
    throw e;
  }
}

export async function cancelReservation(args: {
  schoolId: string;
  reservationId: string;
  actor: ServiceActor;
  reason?: string | null;
  now?: Date;
  skipAudit?: boolean;
}): Promise<ServiceResult<{ reservationId: string; promotedReservationId: string | null }>> {
  const now = args.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.libraryReservation.findFirst({
      where: { id: args.reservationId, schoolId: args.schoolId },
    });
    if (!reservation) return err("NOT_FOUND", 404, "Reservation not found");
    if (reservation.status !== "PENDING") return err("INVALID_STATE", 409, "Reservation is not active");

    const upd = await tx.libraryReservation.updateMany({
      where: { id: reservation.id, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: now, cancelledById: args.actor.userId, cancelReason: args.reason ?? null },
    });
    if (upd.count === 0) return err("INVALID_STATE", 409, "Reservation is not active");

    // Free a held copy if this reservation had one allocated, then FIFO-promote
    // the next eligible reservation for this title into it (if any).
    let promotedReservationId: string | null = null;
    if (reservation.allocatedCopyId) {
      const copy = await tx.libraryBookCopy.findUnique({ where: { id: reservation.allocatedCopyId }, select: { status: true } });
      if (copy?.status === "RESERVED") {
        await tx.libraryBookCopy.update({ where: { id: reservation.allocatedCopyId }, data: { status: "AVAILABLE" } });
        const policy = await getEffectiveLibraryPolicy(args.schoolId, tx);
        const promoted = await promoteReservationQueue(tx, {
          schoolId: args.schoolId,
          bookId: reservation.bookId,
          copyId: reservation.allocatedCopyId,
          reservationHoldDurationDays: policy.reservationHoldDurationDays,
          now,
          actor: args.actor,
        });
        promotedReservationId = promoted?.reservationId ?? null;
      }
    }

    await recordLibraryHistory(tx, {
      schoolId: args.schoolId,
      event: "RESERVATION_CANCELLED",
      reservationId: reservation.id,
      bookId: reservation.bookId,
      borrowerType: reservation.studentId ? "STUDENT" : "TEACHER",
      borrowerId: reservation.studentId ?? reservation.teacherId,
      reason: args.reason ?? null,
      actorId: args.actor.userId,
      actorRole: args.actor.role,
    });

    return { ok: true as const, data: { reservationId: reservation.id, promotedReservationId } };
  });

  if (result.ok && !args.skipAudit) {
    await logAudit({
      action: LIBRARY_EVENT_AUDIT_ACTION.RESERVATION_CANCELLED,
      entityType: "LibraryReservation",
      entityId: result.data.reservationId,
      userId: args.actor.userId,
      schoolId: args.schoolId,
      actorRole: args.actor.role,
    });
    if (result.data.promotedReservationId) {
      await logAudit({
        action: LIBRARY_EVENT_AUDIT_ACTION.COPY_STATUS_CHANGED,
        entityType: "LibraryReservation",
        entityId: result.data.promotedReservationId,
        userId: args.actor.userId,
        schoolId: args.schoolId,
        actorRole: args.actor.role,
        metadata: { reason: "queue_promotion_after_cancellation" },
      });
    }
  }
  return result;
}
