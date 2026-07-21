-- Unified Notification Center v1.
--
-- Additive-only migration: two new enums, one new BackgroundJob JobType
-- value, one new table, its indexes/FKs, and one CHECK constraint. No DROP,
-- no TRUNCATE, no destructive DELETE, and no modification of any prior
-- migration file.
--
-- PostgreSQL enum-safety: `ALTER TYPE "JobType" ADD VALUE 'NOTIFICATION_FANOUT'`
-- is the only enum-value statement touching an EXISTING enum in this file,
-- and the new label 'NOTIFICATION_FANOUT' is never used in a comparison/insert
-- anywhere else in this same file/transaction — a new label added by
-- ALTER TYPE ... ADD VALUE cannot safely be referenced until the adding
-- transaction commits (see the same reasoning already documented in
-- 20260716020000_attendance_v2_parent_leave for AttendanceStatus/'ON_LEAVE').
-- The two NotificationRecipientType/NotificationEventType enums are brand
-- new types, so they carry no such restriction.
--
-- Recipient integrity: Student, Guardian, Teacher and User are four separate
-- identity tables with no shared parent (see prisma/schema.prisma's comment
-- above the Notification model) — a single polymorphic "recipientId" string
-- column would have no real foreign key at all. Instead this table carries
-- four nullable, individually-FK'd recipient columns (studentId, guardianId,
-- teacherId, userId) plus a "recipientType" discriminator, and the CHECK
-- constraint below enforces, at the database level, that EXACTLY ONE of the
-- four is set AND that it matches recipientType. An attempt to insert a row
-- with zero, two, or a mismatched recipient column is rejected by Postgres
-- itself, not just by application code.
--
-- No cascade in this migration can ever delete a School/Student/Guardian/
-- Teacher/User row as a side effect of deleting a Notification — every FK
-- below has Notification as the referencing (child) side; ON DELETE CASCADE
-- only ever flows from the referenced (parent) row to this child table, never
-- the reverse.

-- CreateEnum
CREATE TYPE "NotificationRecipientType" AS ENUM ('STUDENT', 'GUARDIAN', 'TEACHER', 'ADMIN_STAFF');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('HOMEWORK_PUBLISHED', 'HOMEWORK_UPDATED', 'ANNOUNCEMENT_PUBLISHED', 'ANNOUNCEMENT_CORRECTED', 'ATTENDANCE_ABSENT', 'ATTENDANCE_LATE', 'ATTENDANCE_ON_LEAVE', 'ATTENDANCE_CORRECTED', 'STUDENT_LEAVE_APPROVED', 'STUDENT_LEAVE_REJECTED', 'TEACHER_LEAVE_APPROVED', 'TEACHER_LEAVE_REJECTED', 'EARLY_LEAVE_APPROVED', 'EARLY_LEAVE_REJECTED', 'LEAVE_PENDING_REVIEW', 'ATTENDANCE_CORRECTION_PENDING_REVIEW', 'ATTENDANCE_RECONCILIATION_NEEDED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'NOTIFICATION_FANOUT';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "recipientType" "NotificationRecipientType" NOT NULL,
    "studentId" TEXT,
    "guardianId" TEXT,
    "teacherId" TEXT,
    "userId" TEXT,
    "eventType" "NotificationEventType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique idempotency key — the DB-level duplicate-fan-out guard)
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex (per-recipient unread/pagination queries, one index per recipient column)
CREATE INDEX "Notification_schoolId_recipientType_studentId_readAt_create_idx" ON "Notification"("schoolId", "recipientType", "studentId", "readAt", "createdAt");
CREATE INDEX "Notification_schoolId_recipientType_guardianId_readAt_creat_idx" ON "Notification"("schoolId", "recipientType", "guardianId", "readAt", "createdAt");
CREATE INDEX "Notification_schoolId_recipientType_teacherId_readAt_create_idx" ON "Notification"("schoolId", "recipientType", "teacherId", "readAt", "createdAt");
CREATE INDEX "Notification_schoolId_recipientType_userId_readAt_createdAt_idx" ON "Notification"("schoolId", "recipientType", "userId", "readAt", "createdAt");
CREATE INDEX "Notification_schoolId_createdAt_idx" ON "Notification"("schoolId", "createdAt");

-- AddForeignKey (Notification is always the referencing/child side — see header comment)
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recipient-integrity CHECK: exactly one recipient column is set, and it
-- matches recipientType. Rejects zero-recipient, multi-recipient, and
-- type/column-mismatched rows at the database level (see header comment).
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipient_matches_type_check" CHECK (
  (("recipientType" = 'STUDENT') AND "studentId" IS NOT NULL AND "guardianId" IS NULL AND "teacherId" IS NULL AND "userId" IS NULL) OR
  (("recipientType" = 'GUARDIAN') AND "guardianId" IS NOT NULL AND "studentId" IS NULL AND "teacherId" IS NULL AND "userId" IS NULL) OR
  (("recipientType" = 'TEACHER') AND "teacherId" IS NOT NULL AND "studentId" IS NULL AND "guardianId" IS NULL AND "userId" IS NULL) OR
  (("recipientType" = 'ADMIN_STAFF') AND "userId" IS NOT NULL AND "studentId" IS NULL AND "guardianId" IS NULL AND "teacherId" IS NULL)
);
