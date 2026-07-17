import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn() },
}));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
}));

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  issueLoan,
  returnLoan,
  renewLoan,
  waiveFine,
  createReservation,
  cancelReservation,
} from "@/lib/library/service";

const actor = { userId: "u1", role: "SCHOOL_ADMIN" };
const TZ = "Asia/Kolkata";
const NOW = new Date("2026-07-17T06:00:00Z");

function decimal(v: string) {
  return new Prisma.Decimal(v);
}

const DEFAULT_POLICY_ROW = {
  studentBorrowLimit: 3,
  teacherBorrowLimit: 5,
  studentLoanDurationDays: 14,
  teacherLoanDurationDays: 30,
  maxRenewals: 2,
  graceDays: 1,
  finePerOverdueDay: decimal("2.00"),
  reservationsEnabled: true,
  reservationHoldDurationDays: 2,
  blockBorrowingIfOverdue: false,
};

/** Builds a fresh transaction-client mock with sane defaults; override per test. */
function makeTx(overrides: Record<string, unknown> = {}) {
  const base = {
    $queryRaw: vi.fn(async () => [{ id: "cp1" }]),
    libraryBookCopy: {
      findUnique: vi.fn(async () => ({ id: "cp1", schoolId: "s1", bookId: "bk1", status: "AVAILABLE" })),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 5),
    },
    student: { findFirst: vi.fn(async () => ({ id: "st1" })) },
    teacher: { findFirst: vi.fn(async () => ({ id: "t1" })) },
    libraryPolicy: { findUnique: vi.fn(async () => DEFAULT_POLICY_ROW) },
    libraryReservation: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({ id: "res1", requestedAt: NOW })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
    libraryLoan: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "ln1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    libraryBook: {
      findFirst: vi.fn(async () => ({ id: "bk1", schoolId: "s1", status: "ACTIVE" })),
    },
    libraryHistory: { create: vi.fn(async () => ({})) },
  };
  return { ...base, ...overrides } as unknown as Prisma.TransactionClient & typeof base;
}

function mockTransaction(tx: ReturnType<typeof makeTx>) {
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
}

beforeEach(() => vi.clearAllMocks());

// ── issueLoan ──────────────────────────────────────────────────────────────
describe("issueLoan", () => {
  it("returns NOT_FOUND when the row lock finds no matching copy", async () => {
    const tx = makeTx({ $queryRaw: vi.fn(async () => []) });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("returns BORROWER_NOT_FOUND when the student/teacher row does not exist", async () => {
    const tx = makeTx({ student: { findFirst: vi.fn(async () => null) } });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BORROWER_NOT_FOUND");
  });

  it("returns COPY_NOT_AVAILABLE when the copy is not AVAILABLE or RESERVED", async () => {
    const tx = makeTx({
      libraryBookCopy: {
        findUnique: vi.fn(async () => ({ id: "cp1", schoolId: "s1", bookId: "bk1", status: "ISSUED" })),
        update: vi.fn(),
        count: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("COPY_NOT_AVAILABLE");
  });

  it("returns RESERVED_FOR_OTHER when a RESERVED copy is held for a different borrower", async () => {
    const tx = makeTx({
      libraryBookCopy: {
        findUnique: vi.fn(async () => ({ id: "cp1", schoolId: "s1", bookId: "bk1", status: "RESERVED" })),
        update: vi.fn(),
        count: vi.fn(),
      },
      libraryReservation: {
        findMany: vi.fn(async () => [{ id: "res-other", studentId: "other-student", teacherId: null, requestedAt: NOW, expiresAt: null, allocatedCopyId: "cp1" }]),
        findFirst: vi.fn(async () => null),
        count: vi.fn(async () => 0),
        create: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESERVED_FOR_OTHER");
  });

  it("issues a held copy to the borrower it is allocated for", async () => {
    const tx = makeTx({
      libraryBookCopy: {
        findUnique: vi.fn(async () => ({ id: "cp1", schoolId: "s1", bookId: "bk1", status: "RESERVED" })),
        update: vi.fn(async () => ({})),
        count: vi.fn(),
      },
      libraryReservation: {
        findMany: vi.fn(async () => [{ id: "res-mine", studentId: "st1", teacherId: null, requestedAt: NOW, expiresAt: null, allocatedCopyId: "cp1" }]),
        findFirst: vi.fn(async () => null),
        count: vi.fn(async () => 0),
        create: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.fulfilledReservationId).toBe("res-mine");
  });

  it("blocks a walk-in AVAILABLE issue when the reservation queue ahead would consume all copies", async () => {
    const tx = makeTx({
      libraryBookCopy: {
        findUnique: vi.fn(async () => ({ id: "cp1", schoolId: "s1", bookId: "bk1", status: "AVAILABLE" })),
        update: vi.fn(),
        count: vi.fn(async () => 1), // only 1 available copy
      },
      libraryReservation: {
        findMany: vi.fn(async () => [{ id: "res-a", studentId: "other", teacherId: null, requestedAt: NOW, expiresAt: null, allocatedCopyId: null }]),
        findFirst: vi.fn(async () => null),
        count: vi.fn(async () => 0),
        create: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "walkin" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESERVED_FOR_OTHER");
  });

  it("returns LIMIT_EXCEEDED when the borrower is at their active-loan cap", async () => {
    const tx = makeTx({
      libraryLoan: {
        count: vi.fn(async () => 3), // == studentBorrowLimit
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LIMIT_EXCEEDED");
  });

  it("returns BLOCKED_OVERDUE when policy blocks borrowing with an existing overdue loan", async () => {
    const tx = makeTx({
      libraryPolicy: { findUnique: vi.fn(async () => ({ ...DEFAULT_POLICY_ROW, blockBorrowingIfOverdue: true })) },
      libraryLoan: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => [{ dueAt: new Date("2026-07-01T00:00:00Z") }]),
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BLOCKED_OVERDUE");
  });

  it("issues cleanly with no reservation queue and computes dueAt from the student duration", async () => {
    const tx = makeTx();
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.fulfilledReservationId).toBeNull();
      expect(r.data.dueAt.getTime()).toBe(NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
    }
    expect(tx.libraryBookCopy.update).toHaveBeenCalledWith({ where: { id: "cp1" }, data: { status: "ISSUED" } });
  });

  it("maps a P2002 unique-violation on create to COPY_NOT_AVAILABLE (concurrent double-issue)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "x" });
    const tx = makeTx({
      libraryLoan: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(),
        create: vi.fn(async () => { throw p2002; }),
        updateMany: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await issueLoan({ schoolId: "s1", copyId: "cp1", borrower: { type: "STUDENT", id: "st1" }, actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("COPY_NOT_AVAILABLE");
  });
});

// ── returnLoan ─────────────────────────────────────────────────────────────
describe("returnLoan", () => {
  const activeLoan = { id: "ln1", schoolId: "s1", bookCopyId: "cp1", status: "ACTIVE", dueAt: new Date("2026-07-10T00:00:00Z"), studentId: "st1", teacherId: null };

  it("returns NOT_FOUND for a missing loan", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => null), create: vi.fn(), updateMany: vi.fn() } });
    mockTransaction(tx);
    const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("returns ALREADY_RETURNED when the loan is not ACTIVE", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => ({ ...activeLoan, status: "RETURNED" })), create: vi.fn(), updateMany: vi.fn() } });
    mockTransaction(tx);
    const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_RETURNED");
  });

  it("is idempotent: a concurrent racer sees ALREADY_RETURNED when the conditional update matches 0 rows", async () => {
    const tx = makeTx({
      libraryLoan: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(async () => activeLoan),
        create: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })), // another request already flipped it
      },
    });
    mockTransaction(tx);
    const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_RETURNED");
    expect(tx.libraryBookCopy.update).not.toHaveBeenCalled();
  });

  it("on a plain AVAILABLE return with no queue, sets the copy AVAILABLE", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } });
    mockTransaction(tx);
    const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copyStatus).toBe("AVAILABLE");
    expect(tx.libraryBookCopy.update).toHaveBeenCalledWith({ where: { id: "cp1" }, data: { status: "AVAILABLE" } });
  });

  it("promotes the front of the reservation queue and holds the freed copy as RESERVED", async () => {
    const tx = makeTx({
      libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
      libraryBookCopy: {
        findUnique: vi.fn(async () => ({ bookId: "bk1" })),
        update: vi.fn(async () => ({})),
        count: vi.fn(),
      },
      libraryReservation: {
        findMany: vi.fn(),
        findFirst: vi.fn(async () => ({ id: "res-next", requestedAt: NOW, expiresAt: null })),
        count: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(async () => ({})),
      },
    });
    mockTransaction(tx);
    const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copyStatus).toBe("RESERVED");
    expect(tx.libraryReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "res-next" }, data: expect.objectContaining({ allocatedCopyId: "cp1" }) })
    );
    expect(tx.libraryBookCopy.update).toHaveBeenLastCalledWith({ where: { id: "cp1" }, data: { status: "RESERVED" } });
  });

  it("routes a LOST outcome to loan status LOST and copy status LOST with no queue promotion", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } });
    mockTransaction(tx);
    const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, copyOutcome: "LOST", now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copyStatus).toBe("LOST");
    expect(tx.libraryLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "LOST" }) }));
    expect(tx.libraryBookCopy.update).toHaveBeenCalledWith({ where: { id: "cp1" }, data: { status: "LOST" } });
    expect(tx.libraryReservation.findFirst).not.toHaveBeenCalled();
  });

  it("routes DAMAGED and UNDER_REPAIR outcomes to matching copy statuses without queue promotion", async () => {
    for (const outcome of ["DAMAGED", "UNDER_REPAIR"] as const) {
      const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } });
      mockTransaction(tx);
      const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, copyOutcome: outcome, now: NOW });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.copyStatus).toBe(outcome);
      expect(tx.libraryBookCopy.update).toHaveBeenCalledWith({ where: { id: "cp1" }, data: { status: outcome } });
    }
  });

  it("assesses a fine and records a FINE_ASSESSED history entry when overdue", async () => {
    const overdueLoan = { ...activeLoan, dueAt: new Date("2026-07-01T00:00:00Z") };
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => overdueLoan), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } });
    mockTransaction(tx);
    const r = await returnLoan({ schoolId: "s1", loanId: "ln1", actor, timezone: TZ, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number(r.data.fineAssessed)).toBeGreaterThan(0);
    expect(tx.libraryHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ event: "FINE_ASSESSED" }) }));
  });
});

// ── renewLoan ──────────────────────────────────────────────────────────────
describe("renewLoan", () => {
  const activeLoan = { id: "ln1", schoolId: "s1", bookCopyId: "cp1", status: "ACTIVE", dueAt: new Date("2026-07-10T00:00:00Z"), renewalCount: 0, studentId: "st1", teacherId: null };

  it("returns NOT_FOUND for a missing loan", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => null), create: vi.fn(), updateMany: vi.fn() } });
    mockTransaction(tx);
    const r = await renewLoan({ schoolId: "s1", loanId: "ln1", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("returns MAX_RENEWALS once the policy limit is reached", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => ({ ...activeLoan, renewalCount: 2 })), create: vi.fn(), updateMany: vi.fn() } });
    mockTransaction(tx);
    const r = await renewLoan({ schoolId: "s1", loanId: "ln1", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MAX_RENEWALS");
  });

  it("returns INVALID_STATE when the copy is LOST, DAMAGED, or WITHDRAWN", async () => {
    for (const status of ["LOST", "DAMAGED", "WITHDRAWN"]) {
      const tx = makeTx({
        libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn() },
        libraryBookCopy: { findUnique: vi.fn(async () => ({ status, bookId: "bk1" })), update: vi.fn(), count: vi.fn() },
      });
      mockTransaction(tx);
      const r = await renewLoan({ schoolId: "s1", loanId: "ln1", actor, now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("INVALID_STATE");
    }
  });

  it("returns BLOCKED_RESERVATION when another borrower has a live pending reservation", async () => {
    const tx = makeTx({
      libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn() },
      libraryBookCopy: { findUnique: vi.fn(async () => ({ status: "ISSUED", bookId: "bk1" })), update: vi.fn(), count: vi.fn() },
      libraryReservation: {
        findMany: vi.fn(async () => [{ id: "res-x", studentId: "other", teacherId: null, requestedAt: NOW, expiresAt: null }]),
        findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await renewLoan({ schoolId: "s1", loanId: "ln1", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BLOCKED_RESERVATION");
  });

  it("does not block renewal on the borrower's own pending reservation for the same title", async () => {
    const tx = makeTx({
      libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
      libraryBookCopy: { findUnique: vi.fn(async () => ({ status: "ISSUED", bookId: "bk1" })), update: vi.fn(), count: vi.fn() },
      libraryReservation: {
        findMany: vi.fn(async () => [{ id: "res-mine", studentId: "st1", teacherId: null, requestedAt: NOW, expiresAt: null }]),
        findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await renewLoan({ schoolId: "s1", loanId: "ln1", actor, now: NOW });
    expect(r.ok).toBe(true);
  });

  it("is safe under concurrent renewal: a retried call sees the incremented count and returns CONFLICT", async () => {
    const tx = makeTx({
      libraryLoan: {
        count: vi.fn(), findMany: vi.fn(),
        findFirst: vi.fn(async () => activeLoan),
        create: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })), // renewalCount already changed underneath us
      },
      libraryBookCopy: { findUnique: vi.fn(async () => ({ status: "ISSUED", bookId: "bk1" })), update: vi.fn(), count: vi.fn() },
    });
    mockTransaction(tx);
    const r = await renewLoan({ schoolId: "s1", loanId: "ln1", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });

  it("extends dueAt by the borrower-kind duration and increments renewalCount on success", async () => {
    const tx = makeTx({
      libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => activeLoan), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
      libraryBookCopy: { findUnique: vi.fn(async () => ({ status: "ISSUED", bookId: "bk1" })), update: vi.fn(), count: vi.fn() },
    });
    mockTransaction(tx);
    const r = await renewLoan({ schoolId: "s1", loanId: "ln1", actor, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.renewalCount).toBe(1);
      expect(r.data.dueAt.getTime()).toBe(activeLoan.dueAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    }
  });
});

// ── waiveFine ──────────────────────────────────────────────────────────────
describe("waiveFine", () => {
  const loanWithFine = { id: "ln1", schoolId: "s1", fineAssessed: decimal("10.00"), fineWaived: decimal("0.00") };

  it("rejects an empty/whitespace reason before touching the database", async () => {
    const r = await waiveFine({ schoolId: "s1", loanId: "ln1", reason: "   ", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REASON_REQUIRED");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a missing loan", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => null), create: vi.fn(), updateMany: vi.fn() } });
    mockTransaction(tx);
    const r = await waiveFine({ schoolId: "s1", loanId: "ln1", reason: "damaged spine", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("returns NOTHING_TO_WAIVE when there is no outstanding fine", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => ({ ...loanWithFine, fineWaived: decimal("10.00") })), create: vi.fn(), updateMany: vi.fn() } });
    mockTransaction(tx);
    const r = await waiveFine({ schoolId: "s1", loanId: "ln1", reason: "goodwill", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOTHING_TO_WAIVE");
  });

  it("returns CONFLICT when a concurrent waiver already changed fineWaived", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => loanWithFine), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 0 })) } });
    mockTransaction(tx);
    const r = await waiveFine({ schoolId: "s1", loanId: "ln1", reason: "goodwill", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });

  it("waives the full outstanding amount, ignoring any client-computed value", async () => {
    const tx = makeTx({ libraryLoan: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(async () => loanWithFine), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } });
    mockTransaction(tx);
    const r = await waiveFine({ schoolId: "s1", loanId: "ln1", reason: "goodwill", actor, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.waived).toBe("10.00");
    expect(tx.libraryLoan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fineWaived: loanWithFine.fineAssessed, fineWaivedReason: "goodwill" }) })
    );
  });
});

// ── createReservation ──────────────────────────────────────────────────────
describe("createReservation", () => {
  it("returns NOT_FOUND when the book does not exist or is archived", async () => {
    const tx = makeTx({ libraryBook: { findFirst: vi.fn(async () => null) } });
    mockTransaction(tx);
    const r = await createReservation({ schoolId: "s1", bookId: "bk1", borrower: { type: "STUDENT", id: "st1" }, actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("returns RESERVATIONS_DISABLED when the policy turns reservations off", async () => {
    const tx = makeTx({ libraryPolicy: { findUnique: vi.fn(async () => ({ ...DEFAULT_POLICY_ROW, reservationsEnabled: false })) } });
    mockTransaction(tx);
    const r = await createReservation({ schoolId: "s1", bookId: "bk1", borrower: { type: "STUDENT", id: "st1" }, actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESERVATIONS_DISABLED");
  });

  it("returns DUPLICATE_RESERVATION for an existing PENDING reservation on the same title", async () => {
    const tx = makeTx({
      libraryReservation: {
        findMany: vi.fn(), findFirst: vi.fn(async () => ({ id: "existing" })), count: vi.fn(),
        create: vi.fn(), updateMany: vi.fn(), update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await createReservation({ schoolId: "s1", bookId: "bk1", borrower: { type: "STUDENT", id: "st1" }, actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DUPLICATE_RESERVATION");
  });

  it("maps a P2002 unique-violation on create to DUPLICATE_RESERVATION (concurrent double-reserve)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "x" });
    const tx = makeTx({
      libraryReservation: {
        findMany: vi.fn(), findFirst: vi.fn(async () => null), count: vi.fn(),
        create: vi.fn(async () => { throw p2002; }), updateMany: vi.fn(), update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await createReservation({ schoolId: "s1", bookId: "bk1", borrower: { type: "STUDENT", id: "st1" }, actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DUPLICATE_RESERVATION");
  });

  it("computes a 1-based FIFO queue position from reservations requested earlier", async () => {
    const tx = makeTx({
      libraryReservation: {
        findMany: vi.fn(), findFirst: vi.fn(async () => null),
        count: vi.fn(async () => 2), // two earlier PENDING reservations
        create: vi.fn(async () => ({ id: "res-new", requestedAt: NOW })),
        updateMany: vi.fn(), update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await createReservation({ schoolId: "s1", bookId: "bk1", borrower: { type: "STUDENT", id: "st1" }, actor, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.queuePosition).toBe(3);
  });

  it("skips the generic AuditLog write when skipAudit is set (STUDENT/PARENT actors have no User FK)", async () => {
    const tx = makeTx();
    mockTransaction(tx);
    const { logAudit } = await import("@/lib/audit");
    const r = await createReservation({ schoolId: "s1", bookId: "bk1", borrower: { type: "STUDENT", id: "st1" }, actor, now: NOW, skipAudit: true });
    expect(r.ok).toBe(true);
    expect(logAudit).not.toHaveBeenCalled();
  });
});

// ── cancelReservation ──────────────────────────────────────────────────────
describe("cancelReservation", () => {
  it("returns NOT_FOUND for a missing reservation", async () => {
    const tx = makeTx({ libraryReservation: { findMany: vi.fn(), findFirst: vi.fn(async () => null), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() } });
    mockTransaction(tx);
    const r = await cancelReservation({ schoolId: "s1", reservationId: "res1", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_STATE for a reservation that is not PENDING", async () => {
    const tx = makeTx({
      libraryReservation: {
        findMany: vi.fn(), findFirst: vi.fn(async () => ({ id: "res1", status: "CANCELLED", bookId: "bk1", studentId: "st1", teacherId: null, allocatedCopyId: null })),
        count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await cancelReservation({ schoolId: "s1", reservationId: "res1", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");
  });

  it("returns INVALID_STATE on a concurrent race where the conditional update matches 0 rows", async () => {
    const tx = makeTx({
      libraryReservation: {
        findMany: vi.fn(), findFirst: vi.fn(async () => ({ id: "res1", status: "PENDING", bookId: "bk1", studentId: "st1", teacherId: null, allocatedCopyId: null })),
        count: vi.fn(), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 0 })), update: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await cancelReservation({ schoolId: "s1", reservationId: "res1", actor, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");
  });

  it("frees a held copy back to AVAILABLE when the cancelled reservation had one allocated", async () => {
    const tx = makeTx({
      libraryReservation: {
        findMany: vi.fn(),
        findFirst: vi.fn(async () => ({ id: "res1", status: "PENDING", bookId: "bk1", studentId: "st1", teacherId: null, allocatedCopyId: "cp1" })),
        count: vi.fn(), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(),
      },
      libraryBookCopy: {
        findUnique: vi.fn(async () => ({ status: "RESERVED" })),
        update: vi.fn(async () => ({})),
        count: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await cancelReservation({ schoolId: "s1", reservationId: "res1", actor, now: NOW });
    expect(r.ok).toBe(true);
    expect(tx.libraryBookCopy.update).toHaveBeenCalledWith({ where: { id: "cp1" }, data: { status: "AVAILABLE" } });
  });

  it("does not touch the copy when the allocated copy is no longer RESERVED (already reused)", async () => {
    const tx = makeTx({
      libraryReservation: {
        findMany: vi.fn(),
        findFirst: vi.fn(async () => ({ id: "res1", status: "PENDING", bookId: "bk1", studentId: "st1", teacherId: null, allocatedCopyId: "cp1" })),
        count: vi.fn(), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(),
      },
      libraryBookCopy: {
        findUnique: vi.fn(async () => ({ status: "ISSUED" })),
        update: vi.fn(),
        count: vi.fn(),
      },
    });
    mockTransaction(tx);
    const r = await cancelReservation({ schoolId: "s1", reservationId: "res1", actor, now: NOW });
    expect(r.ok).toBe(true);
    expect(tx.libraryBookCopy.update).not.toHaveBeenCalled();
  });
});
