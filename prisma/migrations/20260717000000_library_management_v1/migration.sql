-- Library Management v1 (additive only; forward-only; no destructive change;
-- does not edit any prior migration file).
--
-- The table/enum/index/FK DDL below was generated with
--   prisma migrate diff --from-schema <base> --to-schema prisma/schema.prisma
-- then hand-augmented (this repo's documented exception to "migrations are
-- auto-generated") with:
--   * XOR borrower CHECK constraints (Prisma cannot express an XOR check),
--   * non-negative money/limit/duration CHECK constraints,
--   * the mandatory-waiver-reason CHECK,
--   * partial UNIQUE indexes for "only one ACTIVE loan per copy" and
--     "only one PENDING reservation per (borrower, title)" — the same
--     Postgres partial-index technique as
--     20260709000000_job_dedup_active_unique_index.
--
-- ALTER TYPE ... ADD VALUE for FeatureFlagKey/StoredFileCategory follows the
-- exact pattern of 20260716010000_admissions_v1: the new enum literals are
-- NOT referenced anywhere in this same migration, so PostgreSQL's
-- "new enum value unusable in the transaction that added it" rule is respected.

-- CreateEnum
CREATE TYPE "LibraryCopyStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'RESERVED', 'LOST', 'DAMAGED', 'UNDER_REPAIR', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LibraryBookStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LibraryLoanStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LOST', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "LibraryReservationStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LibraryBorrowerType" AS ENUM ('STUDENT', 'TEACHER');

-- CreateEnum
CREATE TYPE "LibraryHistoryEvent" AS ENUM ('BOOK_CREATED', 'BOOK_UPDATED', 'BOOK_ARCHIVED', 'BOOK_RESTORED', 'COPY_ADDED', 'COPY_STATUS_CHANGED', 'BOOK_ISSUED', 'BOOK_RETURNED', 'LOAN_RENEWED', 'RESERVATION_CREATED', 'RESERVATION_CANCELLED', 'RESERVATION_FULFILLED', 'RESERVATION_EXPIRED', 'FINE_ASSESSED', 'FINE_WAIVED', 'POLICY_CHANGED');

-- AlterEnum
ALTER TYPE "FeatureFlagKey" ADD VALUE 'LIBRARY';

-- AlterEnum
ALTER TYPE "StoredFileCategory" ADD VALUE 'LIBRARY_BOOK_COVER';

-- CreateTable
CREATE TABLE "LibraryBook" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "authors" TEXT,
    "isbn10" TEXT,
    "isbn13" TEXT,
    "publisher" TEXT,
    "edition" TEXT,
    "publicationYear" INTEGER,
    "language" TEXT,
    "category" TEXT,
    "subject" TEXT,
    "description" TEXT,
    "coverFileId" TEXT,
    "status" "LibraryBookStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryBookCopy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "shelfLocation" TEXT,
    "acquisitionDate" TIMESTAMP(3),
    "acquisitionCost" DECIMAL(10,2),
    "condition" TEXT,
    "status" "LibraryCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryBookCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryLoan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookCopyId" TEXT NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "status" "LibraryLoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "finalCondition" TEXT,
    "fineAssessed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fineWaived" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fineWaivedReason" TEXT,
    "fineWaivedById" TEXT,
    "fineWaivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryReservation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "studentId" TEXT,
    "teacherId" TEXT,
    "status" "LibraryReservationStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "allocatedCopyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryPolicy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentBorrowLimit" INTEGER NOT NULL DEFAULT 3,
    "teacherBorrowLimit" INTEGER NOT NULL DEFAULT 5,
    "studentLoanDurationDays" INTEGER NOT NULL DEFAULT 14,
    "teacherLoanDurationDays" INTEGER NOT NULL DEFAULT 30,
    "maxRenewals" INTEGER NOT NULL DEFAULT 2,
    "graceDays" INTEGER NOT NULL DEFAULT 1,
    "finePerOverdueDay" DECIMAL(10,2) NOT NULL DEFAULT 2.00,
    "reservationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reservationHoldDurationDays" INTEGER NOT NULL DEFAULT 2,
    "blockBorrowingIfOverdue" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryHistory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "event" "LibraryHistoryEvent" NOT NULL,
    "bookId" TEXT,
    "copyId" TEXT,
    "loanId" TEXT,
    "reservationId" TEXT,
    "borrowerType" "LibraryBorrowerType",
    "borrowerId" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "fineAmount" DECIMAL(10,2),
    "dueAtBefore" TIMESTAMP(3),
    "dueAtAfter" TIMESTAMP(3),
    "reason" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBook_coverFileId_key" ON "LibraryBook"("coverFileId");

-- CreateIndex
CREATE INDEX "LibraryBook_schoolId_status_idx" ON "LibraryBook"("schoolId", "status");

-- CreateIndex
CREATE INDEX "LibraryBook_schoolId_title_idx" ON "LibraryBook"("schoolId", "title");

-- CreateIndex
CREATE INDEX "LibraryBook_schoolId_category_idx" ON "LibraryBook"("schoolId", "category");

-- CreateIndex
CREATE INDEX "LibraryBook_schoolId_isbn13_idx" ON "LibraryBook"("schoolId", "isbn13");

-- CreateIndex
CREATE INDEX "LibraryBookCopy_schoolId_status_idx" ON "LibraryBookCopy"("schoolId", "status");

-- CreateIndex
CREATE INDEX "LibraryBookCopy_bookId_idx" ON "LibraryBookCopy"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBookCopy_schoolId_accessionNumber_key" ON "LibraryBookCopy"("schoolId", "accessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryBookCopy_schoolId_barcode_key" ON "LibraryBookCopy"("schoolId", "barcode");

-- CreateIndex
CREATE INDEX "LibraryLoan_schoolId_status_idx" ON "LibraryLoan"("schoolId", "status");

-- CreateIndex
CREATE INDEX "LibraryLoan_schoolId_dueAt_idx" ON "LibraryLoan"("schoolId", "dueAt");

-- CreateIndex
CREATE INDEX "LibraryLoan_bookCopyId_idx" ON "LibraryLoan"("bookCopyId");

-- CreateIndex
CREATE INDEX "LibraryLoan_studentId_idx" ON "LibraryLoan"("studentId");

-- CreateIndex
CREATE INDEX "LibraryLoan_teacherId_idx" ON "LibraryLoan"("teacherId");

-- CreateIndex
CREATE INDEX "LibraryReservation_schoolId_status_idx" ON "LibraryReservation"("schoolId", "status");

-- CreateIndex
CREATE INDEX "LibraryReservation_schoolId_bookId_requestedAt_idx" ON "LibraryReservation"("schoolId", "bookId", "requestedAt");

-- CreateIndex
CREATE INDEX "LibraryReservation_studentId_idx" ON "LibraryReservation"("studentId");

-- CreateIndex
CREATE INDEX "LibraryReservation_teacherId_idx" ON "LibraryReservation"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryPolicy_schoolId_key" ON "LibraryPolicy"("schoolId");

-- CreateIndex
CREATE INDEX "LibraryHistory_schoolId_createdAt_idx" ON "LibraryHistory"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryHistory_schoolId_event_idx" ON "LibraryHistory"("schoolId", "event");

-- CreateIndex
CREATE INDEX "LibraryHistory_schoolId_bookId_idx" ON "LibraryHistory"("schoolId", "bookId");

-- CreateIndex
CREATE INDEX "LibraryHistory_schoolId_loanId_idx" ON "LibraryHistory"("schoolId", "loanId");

-- AddForeignKey
ALTER TABLE "LibraryBook" ADD CONSTRAINT "LibraryBook_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBook" ADD CONSTRAINT "LibraryBook_coverFileId_fkey" FOREIGN KEY ("coverFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBookCopy" ADD CONSTRAINT "LibraryBookCopy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryBookCopy" ADD CONSTRAINT "LibraryBookCopy_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_bookCopyId_fkey" FOREIGN KEY ("bookCopyId") REFERENCES "LibraryBookCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_allocatedCopyId_fkey" FOREIGN KEY ("allocatedCopyId") REFERENCES "LibraryBookCopy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryPolicy" ADD CONSTRAINT "LibraryPolicy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryHistory" ADD CONSTRAINT "LibraryHistory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Hand-authored constraints (see header) ──────────────────────────────────

-- Exactly one borrower per loan (student XOR teacher). Prisma's schema language
-- cannot express this, so it is enforced at the DB level here.
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_borrower_xor_check"
  CHECK (("studentId" IS NOT NULL)::int + ("teacherId" IS NOT NULL)::int = 1);

-- Exactly one borrower per reservation (student XOR teacher).
ALTER TABLE "LibraryReservation" ADD CONSTRAINT "LibraryReservation_borrower_xor_check"
  CHECK (("studentId" IS NOT NULL)::int + ("teacherId" IS NOT NULL)::int = 1);

-- Fines are money: never negative, and the waived amount can never exceed the
-- assessed amount (full-waiver v1 sets fineWaived = fineAssessed).
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_fine_nonnegative_check"
  CHECK ("fineAssessed" >= 0 AND "fineWaived" >= 0 AND "fineWaived" <= "fineAssessed");

-- renewalCount is a monotonic non-negative counter.
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_renewalcount_nonnegative_check"
  CHECK ("renewalCount" >= 0);

-- A waiver actor must always carry a mandatory, non-empty reason (and vice
-- versa: a reason without an actor is meaningless).
ALTER TABLE "LibraryLoan" ADD CONSTRAINT "LibraryLoan_waiver_reason_check"
  CHECK (
    ("fineWaivedById" IS NULL AND "fineWaivedReason" IS NULL)
    OR ("fineWaivedById" IS NOT NULL AND "fineWaivedReason" IS NOT NULL AND length(btrim("fineWaivedReason")) > 0)
  );

-- Acquisition cost is money: never negative when recorded.
ALTER TABLE "LibraryBookCopy" ADD CONSTRAINT "LibraryBookCopy_cost_nonnegative_check"
  CHECK ("acquisitionCost" IS NULL OR "acquisitionCost" >= 0);

-- Recorded fine snapshots in history are never negative.
ALTER TABLE "LibraryHistory" ADD CONSTRAINT "LibraryHistory_fine_nonnegative_check"
  CHECK ("fineAmount" IS NULL OR "fineAmount" >= 0);

-- Policy limits/durations/fine-rate are all non-negative planning values.
ALTER TABLE "LibraryPolicy" ADD CONSTRAINT "LibraryPolicy_nonnegative_check"
  CHECK (
    "studentBorrowLimit" >= 0 AND "teacherBorrowLimit" >= 0
    AND "studentLoanDurationDays" >= 0 AND "teacherLoanDurationDays" >= 0
    AND "maxRenewals" >= 0 AND "graceDays" >= 0
    AND "finePerOverdueDay" >= 0 AND "reservationHoldDurationDays" >= 0
  );

-- Only ONE ACTIVE loan may exist per physical copy at a time. This is the final
-- concurrency backstop for the issue workflow (two concurrent issues on the same
-- copy): the app-level status check is advisory, this index is authoritative.
CREATE UNIQUE INDEX "LibraryLoan_active_copy_unique"
  ON "LibraryLoan" ("bookCopyId")
  WHERE "status" = 'ACTIVE';

-- Only ONE PENDING reservation may exist per (borrower, title). Two partial
-- indexes because the borrower is an XOR (student vs teacher) column pair.
CREATE UNIQUE INDEX "LibraryReservation_active_student_unique"
  ON "LibraryReservation" ("bookId", "studentId")
  WHERE "status" = 'PENDING' AND "studentId" IS NOT NULL;

CREATE UNIQUE INDEX "LibraryReservation_active_teacher_unique"
  ON "LibraryReservation" ("bookId", "teacherId")
  WHERE "status" = 'PENDING' AND "teacherId" IS NOT NULL;
