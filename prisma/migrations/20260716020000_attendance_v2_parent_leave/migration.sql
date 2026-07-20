-- Attendance Management v2 + Parent Student-Leave Access
--
-- Forward-only, additive migration. No DROP/TRUNCATE/destructive DELETE, and
-- no modification of any prior migration file.
--
-- PostgreSQL enum-safety note: `ALTER TYPE "AttendanceStatus" ADD VALUE
-- 'ON_LEAVE'` runs below with NO other statement in this file using the
-- LITERAL VALUE 'ON_LEAVE' (no INSERT/UPDATE/DEFAULT/CHECK references it).
-- Only the enum TYPE itself is referenced afterwards (as a column type on the
-- new tables), which PostgreSQL always permits within the same transaction —
-- the restriction is solely on using the new VALUE, which this migration
-- never does. This keeps the single-migration-file requirement compatible
-- with Postgres's "unusable until committed" rule for new enum labels.
--
-- Legacy attendance compatibility strategy: every existing STUDENT Attendance
-- row predates the AttendanceSession concept, so an AttendanceSession row is
-- backfilled for every distinct (schoolId, sectionId, date) combination
-- already present in Attendance, with status = 'DRAFT' (not 'SUBMITTED').
-- We deliberately do NOT mark legacy sessions SUBMITTED: section rosters can
-- have changed since any historical date (transfers, new admissions), so
-- there is no reliable way to confirm a historical day's roster was ever
-- "complete" by today's roster. Marking them DRAFT preserves the pre-feature
-- behavior exactly (mentor teachers can keep freely editing old dates via the
-- existing upsert path) and satisfies "do not silently lock incomplete
-- historical data" — every legacy session starts fully editable, and a
-- school can explicitly submit it later, at which point the normal
-- roster-completeness check applies like any other submission.

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceHistorySource" AS ENUM ('DRAFT_MARK', 'SUBMISSION', 'CORRECTION_APPROVED', 'ADMIN_EMERGENCY', 'LEAVE_RECONCILIATION');

-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'ON_LEAVE';

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrectionRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrectionItem" (
    "id" TEXT NOT NULL,
    "correctionRequestId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "originalStatus" "AttendanceStatus" NOT NULL,
    "requestedStatus" "AttendanceStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCorrectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceHistory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "oldStatus" "AttendanceStatus",
    "newStatus" "AttendanceStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT,
    "source" "AttendanceHistorySource" NOT NULL,
    "correctionRequestId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSession_schoolId_date_idx" ON "AttendanceSession"("schoolId", "date");

-- CreateIndex
CREATE INDEX "AttendanceSession_schoolId_status_idx" ON "AttendanceSession"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_schoolId_sectionId_date_key" ON "AttendanceSession"("schoolId", "sectionId", "date");

-- CreateIndex
CREATE INDEX "AttendanceCorrectionRequest_schoolId_status_idx" ON "AttendanceCorrectionRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AttendanceCorrectionRequest_sessionId_idx" ON "AttendanceCorrectionRequest"("sessionId");

-- CreateIndex
CREATE INDEX "AttendanceCorrectionRequest_requestedById_idx" ON "AttendanceCorrectionRequest"("requestedById");

-- CreateIndex
CREATE INDEX "AttendanceCorrectionItem_studentId_idx" ON "AttendanceCorrectionItem"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCorrectionItem_correctionRequestId_studentId_key" ON "AttendanceCorrectionItem"("correctionRequestId", "studentId");

-- CreateIndex
CREATE INDEX "AttendanceHistory_schoolId_date_idx" ON "AttendanceHistory"("schoolId", "date");

-- CreateIndex
CREATE INDEX "AttendanceHistory_studentId_idx" ON "AttendanceHistory"("studentId");

-- CreateIndex
CREATE INDEX "AttendanceHistory_attendanceId_idx" ON "AttendanceHistory"("attendanceId");

-- CreateIndex
CREATE INDEX "AttendanceHistory_correctionRequestId_idx" ON "AttendanceHistory"("correctionRequestId");

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrectionRequest" ADD CONSTRAINT "AttendanceCorrectionRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrectionRequest" ADD CONSTRAINT "AttendanceCorrectionRequest_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrectionRequest" ADD CONSTRAINT "AttendanceCorrectionRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrectionRequest" ADD CONSTRAINT "AttendanceCorrectionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrectionRequest" ADD CONSTRAINT "AttendanceCorrectionRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrectionItem" ADD CONSTRAINT "AttendanceCorrectionItem_correctionRequestId_fkey" FOREIGN KEY ("correctionRequestId") REFERENCES "AttendanceCorrectionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrectionItem" ADD CONSTRAINT "AttendanceCorrectionItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceHistory" ADD CONSTRAINT "AttendanceHistory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceHistory" ADD CONSTRAINT "AttendanceHistory_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceHistory" ADD CONSTRAINT "AttendanceHistory_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceHistory" ADD CONSTRAINT "AttendanceHistory_correctionRequestId_fkey" FOREIGN KEY ("correctionRequestId") REFERENCES "AttendanceCorrectionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one DRAFT AttendanceSession per existing (schoolId, sectionId, date)
-- combination found in historical STUDENT attendance rows. See migration
-- header for why DRAFT (not SUBMITTED) is the correct, non-destructive choice.
INSERT INTO "AttendanceSession" ("id", "schoolId", "sectionId", "date", "status", "submittedById", "submittedAt", "createdAt", "updatedAt")
SELECT
    'legacy_' || substr(md5("schoolId" || '|' || "sectionId" || '|' || "date"::text), 1, 20) AS id,
    "schoolId",
    "sectionId",
    "date",
    'DRAFT'::"AttendanceSessionStatus",
    NULL,
    NULL,
    now(),
    now()
FROM "Attendance"
WHERE "type" = 'STUDENT' AND "sectionId" IS NOT NULL
GROUP BY "schoolId", "sectionId", "date"
ON CONFLICT ("schoolId", "sectionId", "date") DO NOTHING;
