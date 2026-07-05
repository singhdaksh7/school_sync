-- Smart Timetable Builder (Wave 1 + Wave 2). Additive only — does not touch
-- the live TimetableSlot table or any existing timetable data. See
-- docs/smart-timetable-architecture.md for the domain model this supports.

-- CreateEnum
CREATE TYPE "TimetableDraftStatus" AS ENUM ('DRAFT', 'VALID', 'INVALID', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TimetableDraftSource" AS ENUM ('MANUAL', 'AUTO', 'HYBRID');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'SMART_TIMETABLE_GENERATION';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "defaultMaxConsecutiveTeachingPeriods" INTEGER,
ADD COLUMN     "defaultMaxDailyTeachingPeriods" INTEGER,
ADD COLUMN     "defaultMaxWeeklyTeachingPeriods" INTEGER,
ADD COLUMN     "defaultMinFreeTeachingPeriods" INTEGER,
ADD COLUMN     "timetableWorkingDays" INTEGER NOT NULL DEFAULT 6;

-- CreateTable
CREATE TABLE "TeacherWorkloadOverride" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "maxWeeklyTeachingPeriods" INTEGER,
    "minFreeTeachingPeriods" INTEGER,
    "maxDailyTeachingPeriods" INTEGER,
    "maxConsecutiveTeachingPeriods" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherWorkloadOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherSubjectEligibility" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherSubjectEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableSubjectRequirement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "requiredPeriodsPerWeek" INTEGER NOT NULL,
    "minPeriodsPerDay" INTEGER,
    "maxPeriodsPerDay" INTEGER,
    "allowConsecutive" BOOLEAN NOT NULL DEFAULT false,
    "preferredTeacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableSubjectRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableDraft" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "status" "TimetableDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "TimetableDraftSource" NOT NULL DEFAULT 'MANUAL',
    "qualityScore" DOUBLE PRECISION,
    "configSnapshot" JSONB,
    "diagnostics" JSONB,
    "generationSeed" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "TimetableDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableDraftSlot" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "subjectName" TEXT,
    "teacherId" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableDraftSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherWorkloadOverride_teacherId_key" ON "TeacherWorkloadOverride"("teacherId");

-- CreateIndex
CREATE INDEX "TeacherWorkloadOverride_schoolId_idx" ON "TeacherWorkloadOverride"("schoolId");

-- CreateIndex
CREATE INDEX "TeacherSubjectEligibility_schoolId_subjectName_idx" ON "TeacherSubjectEligibility"("schoolId", "subjectName");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherSubjectEligibility_teacherId_subjectName_key" ON "TeacherSubjectEligibility"("teacherId", "subjectName");

-- CreateIndex
CREATE INDEX "TimetableSubjectRequirement_schoolId_idx" ON "TimetableSubjectRequirement"("schoolId");

-- CreateIndex
CREATE INDEX "TimetableSubjectRequirement_classId_idx" ON "TimetableSubjectRequirement"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSubjectRequirement_sectionId_subjectName_key" ON "TimetableSubjectRequirement"("sectionId", "subjectName");

-- CreateIndex
CREATE INDEX "TimetableDraft_schoolId_idx" ON "TimetableDraft"("schoolId");

-- CreateIndex
CREATE INDEX "TimetableDraft_sectionId_idx" ON "TimetableDraft"("sectionId");

-- CreateIndex
CREATE INDEX "TimetableDraftSlot_teacherId_idx" ON "TimetableDraftSlot"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableDraftSlot_draftId_dayOfWeek_period_key" ON "TimetableDraftSlot"("draftId", "dayOfWeek", "period");

-- AddForeignKey
ALTER TABLE "TeacherWorkloadOverride" ADD CONSTRAINT "TeacherWorkloadOverride_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherWorkloadOverride" ADD CONSTRAINT "TeacherWorkloadOverride_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubjectEligibility" ADD CONSTRAINT "TeacherSubjectEligibility_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSubjectEligibility" ADD CONSTRAINT "TeacherSubjectEligibility_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSubjectRequirement" ADD CONSTRAINT "TimetableSubjectRequirement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSubjectRequirement" ADD CONSTRAINT "TimetableSubjectRequirement_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSubjectRequirement" ADD CONSTRAINT "TimetableSubjectRequirement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSubjectRequirement" ADD CONSTRAINT "TimetableSubjectRequirement_preferredTeacherId_fkey" FOREIGN KEY ("preferredTeacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraft" ADD CONSTRAINT "TimetableDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraftSlot" ADD CONSTRAINT "TimetableDraftSlot_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "TimetableDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableDraftSlot" ADD CONSTRAINT "TimetableDraftSlot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
