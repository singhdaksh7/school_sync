-- Wave C: custom-domain ownership verification.
-- Additive / non-destructive only. The legacy School.customDomain free-text
-- column is left completely untouched (no backfill, no status assumed) — it
-- becomes historical/display-only; host resolution now requires a VERIFIED
-- row in the new CustomDomain table (see src/lib/school-resolver.ts).

-- CreateEnum
CREATE TYPE "CustomDomainStatus" AS ENUM ('PENDING', 'VERIFYING', 'VERIFIED', 'FAILED', 'DISABLED');

-- CreateTable
CREATE TABLE "CustomDomain" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "normalizedHostname" TEXT NOT NULL,
    "status" "CustomDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationMethod" TEXT NOT NULL DEFAULT 'DNS_TXT',
    "verificationToken" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomDomain_normalizedHostname_key" ON "CustomDomain"("normalizedHostname");

-- CreateIndex
CREATE INDEX "CustomDomain_schoolId_idx" ON "CustomDomain"("schoolId");

-- CreateIndex
CREATE INDEX "CustomDomain_status_idx" ON "CustomDomain"("status");

-- AddForeignKey
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
