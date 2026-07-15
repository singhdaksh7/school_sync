-- CreateEnum
CREATE TYPE "SchoolDeletionAuditAction" AS ENUM ('SCHEDULED', 'CANCELLED', 'RESTORED', 'PURGE_STARTED', 'PURGE_PROGRESS', 'PURGE_COMPLETED', 'PURGE_FAILED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'SCHOOL_DATA_PURGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SchoolStatus" ADD VALUE 'PENDING_DELETION';
ALTER TYPE "SchoolStatus" ADD VALUE 'DELETING';
ALTER TYPE "SchoolStatus" ADD VALUE 'DELETION_FAILED';
ALTER TYPE "SchoolStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "deletionCancelledAt" TIMESTAMP(3),
ADD COLUMN     "deletionJobId" TEXT,
ADD COLUMN     "deletionLastError" TEXT,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedById" TEXT,
ADD COLUMN     "deletionRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletionScheduledFor" TIMESTAMP(3),
ADD COLUMN     "preDeletionStatus" "SchoolStatus";

-- CreateTable
CREATE TABLE "SchoolDeletionAudit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "SchoolDeletionAuditAction" NOT NULL,
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolDeletionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolDeletionAudit_schoolId_createdAt_idx" ON "SchoolDeletionAudit"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "School_status_deletionScheduledFor_idx" ON "School"("status", "deletionScheduledFor");
