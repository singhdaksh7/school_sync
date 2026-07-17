-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('BONAFIDE', 'TRANSFER_CERTIFICATE', 'CHARACTER_CERTIFICATE', 'STUDY_CERTIFICATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CertificateRequestStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ISSUED', 'REVOKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CertificateRequesterType" AS ENUM ('STUDENT', 'GUARDIAN', 'STAFF');

-- AlterEnum
ALTER TYPE "FeatureFlagKey" ADD VALUE 'CERTIFICATES';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoredFileCategory" ADD VALUE 'CERTIFICATE_TEMPLATE_ASSET';
ALTER TYPE "StoredFileCategory" ADD VALUE 'CERTIFICATE_DOCUMENT';

-- CreateTable
CREATE TABLE "CertificateRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "certificateType" "CertificateType" NOT NULL,
    "customLabel" TEXT,
    "purpose" TEXT NOT NULL,
    "purposeNormalized" TEXT NOT NULL,
    "requesterType" "CertificateRequesterType" NOT NULL,
    "requesterUserId" TEXT,
    "requesterGuardianId" TEXT,
    "status" "CertificateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "supersedesRequestId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateCounter" (
    "schoolId" TEXT NOT NULL,
    "certificateType" "CertificateType" NOT NULL,
    "sessionLabel" TEXT NOT NULL DEFAULT '',
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateCounter_pkey" PRIMARY KEY ("schoolId","certificateType","sessionLabel")
);

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "certificateType" "CertificateType" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "heading" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "signatoryName" TEXT NOT NULL,
    "signatoryDesignation" TEXT NOT NULL,
    "footerText" TEXT,
    "logoFileId" TEXT,
    "signatureFileId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedCertificate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "certificateType" "CertificateType" NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotData" JSONB NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "verificationTokenHash" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificateRequest_supersedesRequestId_key" ON "CertificateRequest"("supersedesRequestId");

-- CreateIndex
CREATE INDEX "CertificateRequest_schoolId_status_idx" ON "CertificateRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "CertificateRequest_schoolId_studentId_idx" ON "CertificateRequest"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "CertificateRequest_schoolId_certificateType_idx" ON "CertificateRequest"("schoolId", "certificateType");

-- CreateIndex
CREATE INDEX "CertificateRequest_requesterUserId_idx" ON "CertificateRequest"("requesterUserId");

-- CreateIndex
CREATE INDEX "CertificateRequest_requesterGuardianId_idx" ON "CertificateRequest"("requesterGuardianId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateTemplate_logoFileId_key" ON "CertificateTemplate"("logoFileId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateTemplate_signatureFileId_key" ON "CertificateTemplate"("signatureFileId");

-- CreateIndex
CREATE INDEX "CertificateTemplate_schoolId_certificateType_idx" ON "CertificateTemplate"("schoolId", "certificateType");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCertificate_requestId_key" ON "IssuedCertificate"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCertificate_fileId_key" ON "IssuedCertificate"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCertificate_verificationTokenHash_key" ON "IssuedCertificate"("verificationTokenHash");

-- CreateIndex
CREATE INDEX "IssuedCertificate_schoolId_studentId_idx" ON "IssuedCertificate"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "IssuedCertificate_schoolId_certificateType_idx" ON "IssuedCertificate"("schoolId", "certificateType");

-- CreateIndex
CREATE INDEX "IssuedCertificate_revokedAt_idx" ON "IssuedCertificate"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCertificate_schoolId_certificateType_certificateNumbe_key" ON "IssuedCertificate"("schoolId", "certificateType", "certificateNumber");

-- Requester integrity: real foreign keys (requesterUserId/requesterGuardianId)
-- plus a CHECK ensuring exactly one valid requester identity for the
-- declared requesterType. A STUDENT-initiated request uses the request's own
-- studentId as the requester (no separate FK), so both optional requester
-- FKs must be null in that case.
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_requester_integrity_check" CHECK (
  ("requesterType" = 'STUDENT' AND "requesterUserId" IS NULL AND "requesterGuardianId" IS NULL) OR
  ("requesterType" = 'GUARDIAN' AND "requesterGuardianId" IS NOT NULL AND "requesterUserId" IS NULL) OR
  ("requesterType" = 'STAFF' AND "requesterUserId" IS NOT NULL AND "requesterGuardianId" IS NULL)
);

-- A rejection is always accompanied by a note (mandatory reviewer reason).
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_review_note_on_reject_check" CHECK (
  "status" != 'REJECTED' OR ("reviewNote" IS NOT NULL AND length(btrim("reviewNote")) > 0)
);

-- cancelledById is only ever set for a STAFF-initiated cancellation
-- (it is a real FK to User, and a student/guardian requester canceling
-- their own request has no User row — see actions.ts cancelCertificateRequest).
-- A student/guardian self-cancel therefore has cancelledAt set with
-- cancelledById left null; the requester identity in that case is already
-- recorded on the row itself (requesterType/requesterGuardianId/studentId).
-- cancelledById can never be set without cancelledAt also being set.
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_cancelled_by_requires_at_check" CHECK (
  "cancelledById" IS NULL OR "cancelledAt" IS NOT NULL
);

-- CUSTOM certificate requests must carry a school-facing label; non-CUSTOM
-- requests never carry one for a type that already has a defined meaning.
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_custom_label_check" CHECK (
  ("certificateType" = 'CUSTOM' AND "customLabel" IS NOT NULL AND length(btrim("customLabel")) > 0) OR
  ("certificateType" != 'CUSTOM' AND "customLabel" IS NULL)
);

-- Prisma's schema language has no WHERE-clause attribute for @@unique, so the
-- "at most one active template per school+certificateType" invariant and the
-- "no duplicate active request for the same student+type+purpose" invariant
-- are hand-authored partial unique indexes here (mirrors AdmissionCycle's
-- single-open-cycle-per-session pattern in 20260716010000_admissions_v1).
CREATE UNIQUE INDEX "CertificateTemplate_schoolId_certificateType_active_key" ON "CertificateTemplate"("schoolId", "certificateType") WHERE "isActive" = true;

CREATE UNIQUE INDEX "CertificateRequest_active_duplicate_key" ON "CertificateRequest"("schoolId", "studentId", "certificateType", "purposeNormalized") WHERE "status" IN ('PENDING', 'UNDER_REVIEW', 'APPROVED');

-- Mandatory, non-empty revocation reason whenever a certificate is revoked;
-- revokedAt/revokedById are always set together.
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_revocation_integrity_check" CHECK (
  ("revokedAt" IS NULL AND "revokedById" IS NULL AND "revokeReason" IS NULL) OR
  ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "revokeReason" IS NOT NULL AND length(btrim("revokeReason")) > 0)
);

-- certificateNumber is never blank (numbering must always come from the
-- atomic CertificateCounter, never client-supplied or empty).
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_certificate_number_nonblank_check" CHECK (
  length(btrim("certificateNumber")) > 0
);

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_requesterGuardianId_fkey" FOREIGN KEY ("requesterGuardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_supersedesRequestId_fkey" FOREIGN KEY ("supersedesRequestId") REFERENCES "CertificateRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateCounter" ADD CONSTRAINT "CertificateCounter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_signatureFileId_fkey" FOREIGN KEY ("signatureFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CertificateRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CertificateTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
