-- Wave B completion: durable object-storage metadata + background job records.
-- Additive / non-destructive only. No existing tables or columns are altered or
-- dropped; legacy URL/gateway fields remain intact.

-- CreateEnum
CREATE TYPE "StoredFileVisibility" AS ENUM ('PUBLIC', 'TENANT_PRIVATE', 'SCOPED_PRIVATE', 'BILLING_PRIVATE');

-- CreateEnum
CREATE TYPE "StoredFileCategory" AS ENUM ('BRANDING_IMAGE', 'HOMEWORK_ATTACHMENT', 'HOMEWORK_SUBMISSION', 'PAYMENT_PROOF', 'REPORT_CARD_ASSET', 'STUDENT_IMPORT_SOURCE');

-- CreateEnum
CREATE TYPE "FileUploaderActorType" AS ENUM ('USER', 'GUARDIAN', 'STUDENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('REPORT_CARD_BATCH_GENERATION', 'STUDENT_BULK_IMPORT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "category" "StoredFileCategory" NOT NULL,
    "visibility" "StoredFileVisibility" NOT NULL,
    "uploaderType" "FileUploaderActorType" NOT NULL DEFAULT 'USER',
    "uploaderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "resultMetadata" JSONB,
    "errorSummary" TEXT,
    "createdById" TEXT,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "StoredFile_schoolId_category_createdAt_idx" ON "StoredFile"("schoolId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "StoredFile_schoolId_createdAt_idx" ON "StoredFile"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_createdAt_idx" ON "BackgroundJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_schoolId_createdAt_idx" ON "BackgroundJob"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_type_status_idx" ON "BackgroundJob"("type", "status");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Managed-file relations on existing entities ──────────────────────────────
-- Additive only: legacy URL/base64 columns are untouched (receiptData is
-- loosened from NOT NULL to nullable so new payment-proof uploads can store a
-- managed file reference instead of base64; existing rows are unaffected).

-- AlterTable
ALTER TABLE "School" ADD COLUMN "logoFileId" TEXT;
-- AlterTable
ALTER TABLE "ReportCardTemplate" ADD COLUMN "logoFileId" TEXT;
ALTER TABLE "ReportCardTemplate" ADD COLUMN "principalSignatureFileId" TEXT;
ALTER TABLE "ReportCardTemplate" ADD COLUMN "stampFileId" TEXT;
-- AlterTable
ALTER TABLE "Homework" ADD COLUMN "attachmentFileId" TEXT;
-- AlterTable
ALTER TABLE "HomeworkSubmission" ADD COLUMN "attachmentFileId" TEXT;
-- AlterTable
ALTER TABLE "PaymentProofSubmission" ADD COLUMN "receiptFileId" TEXT;
ALTER TABLE "PaymentProofSubmission" ALTER COLUMN "receiptData" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "School_logoFileId_key" ON "School"("logoFileId");
CREATE UNIQUE INDEX "ReportCardTemplate_logoFileId_key" ON "ReportCardTemplate"("logoFileId");
CREATE UNIQUE INDEX "ReportCardTemplate_principalSignatureFileId_key" ON "ReportCardTemplate"("principalSignatureFileId");
CREATE UNIQUE INDEX "ReportCardTemplate_stampFileId_key" ON "ReportCardTemplate"("stampFileId");
CREATE UNIQUE INDEX "Homework_attachmentFileId_key" ON "Homework"("attachmentFileId");
CREATE UNIQUE INDEX "HomeworkSubmission_attachmentFileId_key" ON "HomeworkSubmission"("attachmentFileId");
CREATE UNIQUE INDEX "PaymentProofSubmission_receiptFileId_key" ON "PaymentProofSubmission"("receiptFileId");

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReportCardTemplate" ADD CONSTRAINT "ReportCardTemplate_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReportCardTemplate" ADD CONSTRAINT "ReportCardTemplate_principalSignatureFileId_fkey" FOREIGN KEY ("principalSignatureFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReportCardTemplate" ADD CONSTRAINT "ReportCardTemplate_stampFileId_fkey" FOREIGN KEY ("stampFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_attachmentFileId_fkey" FOREIGN KEY ("attachmentFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_attachmentFileId_fkey" FOREIGN KEY ("attachmentFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentProofSubmission" ADD CONSTRAINT "PaymentProofSubmission_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
