-- Cost Guard & Session Hardening. Additive only — no existing tables altered
-- except two new nullable/defaulted columns (BackgroundJob.payloadFingerprint,
-- StoredFile retention fields) and one new JobType enum value. See
-- docs/cost-guard-session-architecture.md.

-- CreateEnum
CREATE TYPE "FileRetentionPolicy" AS ENUM ('EXPIRING', 'LONG_TERM', 'REFERENCE_MANAGED');

-- CreateEnum
CREATE TYPE "SessionActorType" AS ENUM ('PARENT', 'STUDENT', 'TEACHER', 'ADMIN_STAFF');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'FILE_RETENTION_CLEANUP';

-- AlterTable
ALTER TABLE "BackgroundJob" ADD COLUMN     "payloadFingerprint" TEXT;

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "retentionPolicy" "FileRetentionPolicy" NOT NULL DEFAULT 'REFERENCE_MANAGED';

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "actorType" "SessionActorType" NOT NULL,
    "userId" TEXT,
    "teacherId" TEXT,
    "guardianId" TEXT,
    "studentId" TEXT,
    "sessionTokenHash" TEXT NOT NULL,
    "deviceInstallationId" TEXT,
    "deviceName" TEXT,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLoginEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "actorType" "SessionActorType" NOT NULL,
    "userId" TEXT,
    "teacherId" TEXT,
    "guardianId" TEXT,
    "studentId" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthFailureState" (
    "id" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "authFlow" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthFailureState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_sessionTokenHash_key" ON "AuthSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_schoolId_actorType_userId_idx" ON "AuthSession"("schoolId", "actorType", "userId");

-- CreateIndex
CREATE INDEX "AuthSession_schoolId_actorType_teacherId_idx" ON "AuthSession"("schoolId", "actorType", "teacherId");

-- CreateIndex
CREATE INDEX "AuthSession_schoolId_actorType_guardianId_idx" ON "AuthSession"("schoolId", "actorType", "guardianId");

-- CreateIndex
CREATE INDEX "AuthSession_schoolId_actorType_studentId_idx" ON "AuthSession"("schoolId", "actorType", "studentId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthLoginEvent_schoolId_actorType_userId_createdAt_idx" ON "AuthLoginEvent"("schoolId", "actorType", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthLoginEvent_schoolId_actorType_teacherId_createdAt_idx" ON "AuthLoginEvent"("schoolId", "actorType", "teacherId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthLoginEvent_schoolId_actorType_guardianId_createdAt_idx" ON "AuthLoginEvent"("schoolId", "actorType", "guardianId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthLoginEvent_schoolId_actorType_studentId_createdAt_idx" ON "AuthLoginEvent"("schoolId", "actorType", "studentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthLoginEvent_createdAt_idx" ON "AuthLoginEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthFailureState_bucketKey_key" ON "AuthFailureState"("bucketKey");

-- CreateIndex
CREATE INDEX "AuthFailureState_schoolId_idx" ON "AuthFailureState"("schoolId");

-- CreateIndex
CREATE INDEX "AuthFailureState_lockedUntil_idx" ON "AuthFailureState"("lockedUntil");

-- CreateIndex
CREATE INDEX "BackgroundJob_schoolId_type_status_payloadFingerprint_idx" ON "BackgroundJob"("schoolId", "type", "status", "payloadFingerprint");

-- CreateIndex
CREATE INDEX "StoredFile_expiresAt_deletedAt_idx" ON "StoredFile"("expiresAt", "deletedAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthLoginEvent" ADD CONSTRAINT "AuthLoginEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthFailureState" ADD CONSTRAINT "AuthFailureState_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

