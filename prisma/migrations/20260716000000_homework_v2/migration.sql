-- Homework 2.0: additive schema only. No existing column is dropped,
-- renamed, or retyped; no existing row's data is rewritten except the
-- deterministic assessmentMode backfill below (which only ever *adds*
-- information — it never touches score/maxScore/teacherRemark content).
--
-- Postgres note: this migration adds two new values to the EXISTING
-- HomeworkStatus enum (DRAFT, SCHEDULED) but never references either new
-- value later in this same file/transaction — Postgres forbids using a
-- newly-added enum value in the same transaction it was added in, so this
-- ordering is deliberate, not incidental.

-- AlterEnum: new lifecycle states, inserted before ACTIVE so the enum's
-- ordinal order matches the lifecycle's logical order (Draft -> Scheduled
-- -> Active -> Closed -> Cancelled). Existing ACTIVE/CLOSED/CANCELLED rows
-- and the column's default (ACTIVE) are completely unaffected.
ALTER TYPE "HomeworkStatus" ADD VALUE 'DRAFT' BEFORE 'ACTIVE';
ALTER TYPE "HomeworkStatus" ADD VALUE 'SCHEDULED' BEFORE 'ACTIVE';

-- CreateEnum: brand-new type (not an ADD VALUE to an existing one), safe to
-- both create and use later in this same transaction.
CREATE TYPE "HomeworkAssessmentMode" AS ENUM ('CHECKING_ONLY', 'GRADED');

-- AlterTable: Homework — new columns only.
ALTER TABLE "Homework"
  ADD COLUMN "checkingDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "assessmentMode" "HomeworkAssessmentMode" NOT NULL DEFAULT 'CHECKING_ONLY',
  ADD COLUMN "maxMarks" DOUBLE PRECISION;

-- AlterTable: HomeworkStudentStatus / HomeworkSubmission — new
-- student/guardian-visible feedback column, distinct from the existing
-- teacherRemark column (which stays private-only going forward — see the
-- schema.prisma comments on both models). Deliberately NOT backfilled from
-- teacherRemark: we cannot safely infer which historical remarks the
-- teacher intended as private vs. student-facing, so every pre-2.0 row
-- gets a clean NULL here rather than a guessed value. teacherRemark's own
-- content is completely untouched either way.
ALTER TABLE "HomeworkStudentStatus" ADD COLUMN "studentFeedback" TEXT;
ALTER TABLE "HomeworkSubmission" ADD COLUMN "studentFeedback" TEXT;

-- Deterministic assessmentMode backfill for every pre-existing Homework
-- row: GRADED if ANY related HomeworkStudentStatus or HomeworkSubmission
-- row ever recorded a non-null maxScore (i.e. a teacher entered marks under
-- the pre-2.0 flow), otherwise the column default (CHECKING_ONLY) is left
-- as-is. This is a one-time, one-directional classification — it never
-- changes any score/maxScore/teacherRemark value, only which of the two new
-- assessment-mode buckets a legacy homework record is placed into.
--
-- Homework.maxMarks is deliberately left NULL for every backfilled GRADED
-- row (not derived from any per-student maxScore): historical per-student
-- maxScore values were never required to agree with each other across a
-- single Homework's roster under the pre-2.0 flow, so there is no single
-- correct "the" max to promote to the homework-level field without risking
-- an incorrect guess. The application enforces "maxMarks required, > 0"
-- only for homework CREATED OR EDITED under the 2.0 flow going forward
-- (see src/lib/homework.ts validateAssessmentMode) — legacy GRADED rows
-- with maxMarks still NULL keep working exactly as before (each row's own
-- historical maxScore continues to bound its own marks).
UPDATE "Homework"
SET "assessmentMode" = 'GRADED'
WHERE "id" IN (
  SELECT "homeworkId" FROM "HomeworkStudentStatus" WHERE "maxScore" IS NOT NULL
  UNION
  SELECT "homeworkId" FROM "HomeworkSubmission" WHERE "maxScore" IS NOT NULL
);

-- CHECK constraints. Both use "<=" / "IS NULL OR >=" (permissive, not
-- strict "<" / ">") specifically so every pre-existing row already
-- satisfies them without a data fix — the pre-2.0 create route always set
-- dueDate = deadlineAt (equal, never dueDate > deadlineAt), and
-- checkingDeadlineAt is a brand-new column that is NULL on every existing
-- row. Strict ordering ("start must be BEFORE deadline") is enforced by
-- the API/service layer (Zod validation) for new and edited homework —
-- see src/lib/homework.ts validateHomeworkDates — not by these DB
-- constraints, so this migration never rejects the historical data it is
-- applied against.
ALTER TABLE "Homework" ADD CONSTRAINT "homework_due_before_or_at_deadline"
  CHECK ("dueDate" <= "deadlineAt");

ALTER TABLE "Homework" ADD CONSTRAINT "homework_checking_deadline_not_before_deadline"
  CHECK ("checkingDeadlineAt" IS NULL OR "checkingDeadlineAt" >= "deadlineAt");

-- CHECKING_ONLY homework must never carry a maxMarks value — this direction
-- holds unconditionally for every row (old and new: the column is brand new
-- and NULL everywhere, and CHECKING_ONLY is the pre-2.0 default), so it is
-- safe as a hard DB constraint. The opposite direction ("GRADED requires
-- maxMarks IS NOT NULL and > 0") is intentionally NOT a DB constraint — see
-- the backfill comment above for why legacy GRADED rows may have a NULL
-- maxMarks — and is instead enforced in the API/service layer for
-- create/edit going forward.
ALTER TABLE "Homework" ADD CONSTRAINT "homework_checking_only_has_no_max_marks"
  CHECK ("assessmentMode" <> 'CHECKING_ONLY' OR "maxMarks" IS NULL);

CREATE INDEX "Homework_schoolId_assessmentMode_idx" ON "Homework"("schoolId", "assessmentMode");
