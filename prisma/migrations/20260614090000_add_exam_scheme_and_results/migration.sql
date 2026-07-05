-- GENUINE MIGRATION HISTORY FIX (discovered during disposable-DB pilot
-- verification, not a Wave B/C change): `ExamScheme`, `Exam`, and
-- `ExamResult` are real models in schema.prisma and are referenced by a
-- foreign key in the very next migration
-- (20260614093000_report_cards → ReportCard.examSchemeId), but no migration
-- in this repository's history ever creates them — they were evidently
-- introduced via `prisma db push` at some point and a matching migration was
-- never generated. Applying the full migration chain to a fresh database
-- fails at 20260614093000_report_cards with:
--   ERROR: relation "ExamScheme" does not exist
--
-- This migration is written to be SAFE to run against a database that
-- already has these tables (e.g. a long-lived Neon database that had them
-- created via `db push` before migrations were adopted) — every statement is
-- guarded to be a no-op if the object already exists, so this is safe to
-- deploy anywhere without risking a duplicate-object error on an existing
-- production database. On a genuinely fresh database (as tested here) it
-- performs the real, additive creation.

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "ExamScheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamScheme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Exam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxMarks" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "schemeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExamResult" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL,
    "submittedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (each guarded — Postgres has no `CREATE UNIQUE INDEX IF NOT EXISTS`
-- for constraint-backed indexes in older syntax, so use a DO block per index).
DO $$ BEGIN
    CREATE UNIQUE INDEX "ExamScheme_name_schoolId_key" ON "ExamScheme"("name", "schoolId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE UNIQUE INDEX "ExamResult_examId_studentId_key" ON "ExamResult"("examId", "studentId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE INDEX "ExamResult_examId_idx" ON "ExamResult"("examId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE INDEX "ExamResult_studentId_idx" ON "ExamResult"("studentId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- AddForeignKey (guarded — Postgres raises duplicate_object if the named
-- constraint already exists).
DO $$ BEGIN
    ALTER TABLE "ExamScheme" ADD CONSTRAINT "ExamScheme_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Exam" ADD CONSTRAINT "Exam_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "ExamScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
