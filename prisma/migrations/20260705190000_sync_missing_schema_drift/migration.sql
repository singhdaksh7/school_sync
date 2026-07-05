-- GENUINE MIGRATION HISTORY FIX (discovered during disposable-DB pilot
-- verification). `npx prisma migrate diff --from-config-datasource
-- --to-schema prisma/schema.prisma --script`, run against a disposable
-- Postgres database that had the ENTIRE existing migration history applied
-- (34 original migrations + the two earlier ExamScheme/TeacherInvite fixes),
-- revealed that schema.prisma has drifted well ahead of what any migration
-- actually creates: two new UserRole enum values, several columns
-- (School.periodsPerDay, SchoolInvite.role, Teacher.mentorSectionId,
-- Teacher.userId), a changed FK action on FeePayment.recordedById, a
-- dropped column default on FeePayment.paidAt, an entire missing table
-- (TimetableSlot), and a long list of missing indexes across
-- Announcement/Attendance/AuditLog/FeePayment/LeaveRequest/Student/Teacher.
--
-- Same root cause as the two prior fixes in this pilot pass: these were
-- evidently applied to the real database via `prisma db push` over time
-- without ever generating a matching migration. This migration captures
-- that entire accumulated diff in one idempotent step so the migration
-- chain is provably complete (this is exactly what the disposable-DB pilot
-- run is for). Every statement is guarded to be a no-op if already applied,
-- so it is safe to run against a database that already has some or all of
-- this state (e.g. the real Neon database, which is presumably already
-- fully migrated via `db push` for all of the above).

-- AlterEnum (idempotent: IF NOT EXISTS on enum values is PG 9.6+)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VICE_PRINCIPAL';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'TEACHER';

-- DropForeignKey (idempotent)
ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_recordedById_fkey";

-- AlterTable (idempotent: DROP DEFAULT is a safe no-op if there is none)
ALTER TABLE "FeePayment" ALTER COLUMN "paidAt" DROP DEFAULT;

-- AlterTable (idempotent)
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "periodsPerDay" INTEGER NOT NULL DEFAULT 6;

-- AlterTable (idempotent)
ALTER TABLE "SchoolInvite" ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'SCHOOL_ADMIN';

-- AlterTable (idempotent)
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "mentorSectionId" TEXT,
ADD COLUMN IF NOT EXISTS "userId" TEXT;

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "TimetableSlot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "teacherId" TEXT,
    "subject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent: IF NOT EXISTS is supported for both plain and unique indexes, PG 9.5+)
CREATE UNIQUE INDEX IF NOT EXISTS "TimetableSlot_sectionId_dayOfWeek_period_key" ON "TimetableSlot"("sectionId", "dayOfWeek", "period");
CREATE INDEX IF NOT EXISTS "Announcement_schoolId_publishedAt_idx" ON "Announcement"("schoolId", "publishedAt");
CREATE INDEX IF NOT EXISTS "Attendance_schoolId_date_type_idx" ON "Attendance"("schoolId", "date", "type");
CREATE INDEX IF NOT EXISTS "Attendance_schoolId_type_idx" ON "Attendance"("schoolId", "type");
CREATE INDEX IF NOT EXISTS "Attendance_studentId_idx" ON "Attendance"("studentId");
CREATE INDEX IF NOT EXISTS "Attendance_teacherId_idx" ON "Attendance"("teacherId");
CREATE INDEX IF NOT EXISTS "AuditLog_schoolId_createdAt_idx" ON "AuditLog"("schoolId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_schoolId_entityType_idx" ON "AuditLog"("schoolId", "entityType");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX IF NOT EXISTS "FeePayment_schoolId_paidAt_idx" ON "FeePayment"("schoolId", "paidAt");
CREATE INDEX IF NOT EXISTS "FeePayment_studentId_idx" ON "FeePayment"("studentId");
CREATE INDEX IF NOT EXISTS "LeaveRequest_schoolId_status_idx" ON "LeaveRequest"("schoolId", "status");
CREATE INDEX IF NOT EXISTS "LeaveRequest_teacherId_idx" ON "LeaveRequest"("teacherId");
CREATE INDEX IF NOT EXISTS "LeaveRequest_studentId_idx" ON "LeaveRequest"("studentId");
CREATE INDEX IF NOT EXISTS "Student_schoolId_idx" ON "Student"("schoolId");
CREATE INDEX IF NOT EXISTS "Student_sectionId_idx" ON "Student"("sectionId");
CREATE INDEX IF NOT EXISTS "Student_schoolId_sectionId_idx" ON "Student"("schoolId", "sectionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Teacher_userId_key" ON "Teacher"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Teacher_mentorSectionId_key" ON "Teacher"("mentorSectionId");
CREATE INDEX IF NOT EXISTS "Teacher_schoolId_idx" ON "Teacher"("schoolId");

-- AddForeignKey (guarded: no IF NOT EXISTS for constraints in Postgres)
DO $$ BEGIN
    ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_mentorSectionId_fkey" FOREIGN KEY ("mentorSectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
