-- Admissions Management v1 (additive only; no destructive changes; does not
-- touch any prior migration file).
--
-- NOTE: this branch was forked from baseline a8b9c890c85aa975f8bc958c151f62b52e439fc2
-- in parallel with the Homework 2.0 and Targeted Announcements feature
-- branches (separate worktrees, same baseline). Migration ordering relative
-- to those branches' migrations must be rechecked (and this migration
-- renumbered/rebased if needed) once they merge into main first.

-- CreateEnum
CREATE TYPE "AdmissionCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdmissionApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'DOCUMENTS_PENDING', 'INTERVIEW_SCHEDULED', 'ASSESSMENT_SCHEDULED', 'WAITLISTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'ENROLLED');

-- CreateEnum
CREATE TYPE "AdmissionDocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdmissionReviewEventType" AS ENUM ('INTERVIEW', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "AdmissionReviewEventStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AdmissionNoteType" AS ENUM ('INTERNAL', 'APPLICANT_VISIBLE');

-- AlterEnum: new ADMISSIONS module flag (SchoolFeatureFlag.key). Absence of a
-- row means enabled-by-default (see src/lib/feature-flags.ts), matching every
-- other flag's convention — so Admissions is available to every school in v1
-- without a backfill, per spec.
ALTER TYPE "FeatureFlagKey" ADD VALUE 'ADMISSIONS';

-- CreateTable
CREATE TABLE "AdmissionCycle" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionLabel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applicationStartAt" TIMESTAMP(3) NOT NULL,
    "applicationEndAt" TIMESTAMP(3) NOT NULL,
    "status" "AdmissionCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionOffering" (
    "id" TEXT NOT NULL,
    "admissionCycleId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "applicationsOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable: per-school monotonic counter backing concurrency-safe
-- application-number generation (see src/lib/admissions/application-number.ts)
-- — INSERT ... ON CONFLICT DO UPDATE SET lastValue = lastValue + 1 RETURNING
-- lastValue, never a SELECT count()+1 race.
CREATE TABLE "AdmissionNumberCounter" (
    "schoolId" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionNumberCounter_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "AdmissionApplication" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "admissionCycleId" TEXT NOT NULL,
    "admissionOfferingId" TEXT NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "status" "AdmissionApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "applicantFirstName" TEXT NOT NULL,
    "applicantMiddleName" TEXT,
    "applicantLastName" TEXT NOT NULL,
    "applicantDob" DATE NOT NULL,
    "applicantGender" TEXT,
    "currentSchoolName" TEXT,
    "previousSchoolName" TEXT,
    "guardianName" TEXT NOT NULL,
    "guardianRelation" TEXT NOT NULL,
    "guardianPhone" TEXT NOT NULL,
    "guardianEmail" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "addressCity" TEXT,
    "addressState" TEXT,
    "addressPostalCode" TEXT,
    "source" TEXT,
    "overriddenById" TEXT,
    "overrideReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "enrolledStudentId" TEXT,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "verificationStatus" "AdmissionDocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewReason" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionReviewEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "AdmissionReviewEventType" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "evaluatorTeacherId" TEXT,
    "location" TEXT,
    "instructions" TEXT,
    "status" "AdmissionReviewEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "score" INTEGER,
    "maxScore" INTEGER,
    "result" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionNote" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "AdmissionNoteType" NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable: immutable audit trail of every application status transition,
-- always written inside the same transaction as the transition itself.
CREATE TABLE "AdmissionStatusHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "previousStatus" "AdmissionApplicationStatus",
    "newStatus" "AdmissionApplicationStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdmissionCycle_schoolId_idx" ON "AdmissionCycle"("schoolId");

-- CreateIndex
CREATE INDEX "AdmissionCycle_schoolId_status_idx" ON "AdmissionCycle"("schoolId", "status");

-- One-active-cycle-per-school/session invariant: at most one OPEN cycle per
-- (schoolId, sessionLabel) at a time. A hand-authored PARTIAL UNIQUE INDEX —
-- Prisma's schema language has no WHERE-clause attribute for @@unique, so
-- this is NOT expressible in schema.prisma and must not be "fixed" by a
-- future `prisma migrate diff`/`db pull`. DRAFT/CLOSED/ARCHIVED cycles for the
-- same session are intentionally not restricted (a school may keep historical
-- or draft cycles around); app-level checks in
-- src/lib/admissions/cycles.ts additionally surface a warning when opening a
-- second cycle for a session that already has one open, in case a school
-- intentionally runs two concurrent sessions.
CREATE UNIQUE INDEX "AdmissionCycle_schoolId_sessionLabel_open_key" ON "AdmissionCycle"("schoolId", "sessionLabel") WHERE "status" = 'OPEN';

-- CHECK: applicationStartAt must precede applicationEndAt.
ALTER TABLE "AdmissionCycle" ADD CONSTRAINT "AdmissionCycle_window_order_check" CHECK ("applicationStartAt" < "applicationEndAt");

-- CreateIndex
CREATE INDEX "AdmissionOffering_admissionCycleId_idx" ON "AdmissionOffering"("admissionCycleId");

-- CreateIndex
CREATE INDEX "AdmissionOffering_classId_idx" ON "AdmissionOffering"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionOffering_admissionCycleId_classId_key" ON "AdmissionOffering"("admissionCycleId", "classId");

-- CHECK: capacity is planning info only, never negative.
ALTER TABLE "AdmissionOffering" ADD CONSTRAINT "AdmissionOffering_capacity_nonnegative_check" CHECK ("capacity" >= 0);

-- CreateIndex: enforces "an application can't be enrolled twice" at the DB
-- level (paired with the status='APPROVED' AND enrolledStudentId IS NULL
-- WHERE-guard on the enrollment UPDATE — see src/lib/admissions/enrollment.ts).
CREATE UNIQUE INDEX "AdmissionApplication_enrolledStudentId_key" ON "AdmissionApplication"("enrolledStudentId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_status_idx" ON "AdmissionApplication"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_admissionCycleId_idx" ON "AdmissionApplication"("schoolId", "admissionCycleId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_admissionOfferingId_idx" ON "AdmissionApplication"("admissionOfferingId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_guardianPhone_idx" ON "AdmissionApplication"("schoolId", "guardianPhone");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_applicantLastName_applicantFi_idx" ON "AdmissionApplication"("schoolId", "applicantLastName", "applicantFirstName");

-- CreateIndex: human-readable application number, unique within a school.
CREATE UNIQUE INDEX "AdmissionApplication_schoolId_applicationNumber_key" ON "AdmissionApplication"("schoolId", "applicationNumber");

-- CHECK: applicant DOB must be in the past (also re-validated at the Zod
-- boundary with the "not more than 100 years ago" upper bound, which a CHECK
-- alone can't express against `now()` portably across a restore/replay).
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_dob_past_check" CHECK ("applicantDob" < CURRENT_DATE);

-- CHECK: a mandatory override reason must accompany any override actor.
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_override_reason_check" CHECK ("overriddenById" IS NULL OR ("overrideReason" IS NOT NULL AND length(btrim("overrideReason")) > 0));

-- CreateIndex
CREATE INDEX "AdmissionDocument_applicationId_idx" ON "AdmissionDocument"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionDocument_schoolId_idx" ON "AdmissionDocument"("schoolId");

-- CHECK: size must be a sane positive byte count (repo upload policy caps the
-- actual max at the API layer; this is a DB-level sanity backstop only).
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_size_positive_check" CHECK ("size" > 0);

-- CreateIndex
CREATE INDEX "AdmissionReviewEvent_applicationId_idx" ON "AdmissionReviewEvent"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionReviewEvent_schoolId_idx" ON "AdmissionReviewEvent"("schoolId");

-- CreateIndex
CREATE INDEX "AdmissionReviewEvent_evaluatorTeacherId_idx" ON "AdmissionReviewEvent"("evaluatorTeacherId");

-- CHECK: score must fall within [0, maxScore] whenever both are recorded;
-- either may independently be NULL until an evaluator records a result.
ALTER TABLE "AdmissionReviewEvent" ADD CONSTRAINT "AdmissionReviewEvent_score_bounds_check" CHECK (
    ("score" IS NULL AND "maxScore" IS NULL)
    OR ("score" IS NULL AND "maxScore" >= 0)
    OR ("maxScore" IS NULL AND "score" >= 0)
    OR ("score" >= 0 AND "maxScore" >= 0 AND "score" <= "maxScore")
);

-- CreateIndex
CREATE INDEX "AdmissionNote_applicationId_idx" ON "AdmissionNote"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionNote_schoolId_idx" ON "AdmissionNote"("schoolId");

-- CreateIndex
CREATE INDEX "AdmissionNote_applicationId_type_idx" ON "AdmissionNote"("applicationId", "type");

-- CreateIndex
CREATE INDEX "AdmissionStatusHistory_applicationId_idx" ON "AdmissionStatusHistory"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionStatusHistory_schoolId_idx" ON "AdmissionStatusHistory"("schoolId");

-- AddForeignKey
ALTER TABLE "AdmissionCycle" ADD CONSTRAINT "AdmissionCycle_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionCycle" ADD CONSTRAINT "AdmissionCycle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionOffering" ADD CONSTRAINT "AdmissionOffering_admissionCycleId_fkey" FOREIGN KEY ("admissionCycleId") REFERENCES "AdmissionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionOffering" ADD CONSTRAINT "AdmissionOffering_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionNumberCounter" ADD CONSTRAINT "AdmissionNumberCounter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_admissionCycleId_fkey" FOREIGN KEY ("admissionCycleId") REFERENCES "AdmissionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_admissionOfferingId_fkey" FOREIGN KEY ("admissionOfferingId") REFERENCES "AdmissionOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_enrolledStudentId_fkey" FOREIGN KEY ("enrolledStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionReviewEvent" ADD CONSTRAINT "AdmissionReviewEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionReviewEvent" ADD CONSTRAINT "AdmissionReviewEvent_evaluatorTeacherId_fkey" FOREIGN KEY ("evaluatorTeacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionReviewEvent" ADD CONSTRAINT "AdmissionReviewEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionNote" ADD CONSTRAINT "AdmissionNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionNote" ADD CONSTRAINT "AdmissionNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStatusHistory" ADD CONSTRAINT "AdmissionStatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStatusHistory" ADD CONSTRAINT "AdmissionStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
