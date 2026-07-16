-- Targeted announcements: scope/audience/status/schedule/expiry, per-recipient
-- read tracking, and class/section targeting.
--
-- Legacy compatibility: every pre-existing Announcement row was implicitly
-- school-wide and visible to both students and parents (the old
-- /api/student/announcements and /api/parent/announcements handlers queried
-- only `schoolId`, with no audience filter at all). The new "scope" and
-- "status" columns are added WITH DEFAULTs ('SCHOOL_WIDE' / 'PUBLISHED'),
-- which Postgres back-fills onto every existing row automatically. We then
-- explicitly back-fill an AnnouncementAudience row of STUDENTS and one of
-- GUARDIANS for every existing announcement below — i.e. exactly the
-- population that could already see them, no more, no less. No
-- AnnouncementTarget rows are created for legacy rows (they stay
-- school-wide). createdAt/publishedAt ordering is untouched (publishedAt
-- keeps its existing value; only its NOT NULL/DEFAULT are relaxed so future
-- DRAFT/SCHEDULED rows can have publishedAt = NULL until actually published).

-- CreateEnum
CREATE TYPE "AnnouncementScope" AS ENUM ('SCHOOL_WIDE', 'CLASS_SECTION');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnnouncementAudienceGroup" AS ENUM ('TEACHERS', 'GUARDIANS', 'STUDENTS');

-- CreateEnum
CREATE TYPE "AnnouncementReadActorType" AS ENUM ('STUDENT', 'GUARDIAN', 'TEACHER');

-- AlterTable: relax publishedAt (was NOT NULL DEFAULT CURRENT_TIMESTAMP) so
-- future DRAFT/SCHEDULED rows can hold NULL until actually published.
-- Existing rows keep their current publishedAt value untouched.
ALTER TABLE "Announcement" ALTER COLUMN "publishedAt" DROP DEFAULT;
ALTER TABLE "Announcement" ALTER COLUMN "publishedAt" DROP NOT NULL;

-- AlterTable: new columns. scope/status/correctionCount use DEFAULTs so
-- existing rows are back-filled to SCHOOL_WIDE / PUBLISHED / 0 automatically.
ALTER TABLE "Announcement"
  ADD COLUMN "scope" "AnnouncementScope" NOT NULL DEFAULT 'SCHOOL_WIDE',
  ADD COLUMN "status" "AnnouncementStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "createdByRole" TEXT,
  ADD COLUMN "lastEditedById" TEXT,
  ADD COLUMN "lastEditedAt" TIMESTAMP(3),
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "publishedById" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "correctionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT;

-- CreateIndex
CREATE INDEX "Announcement_schoolId_status_idx" ON "Announcement"("schoolId", "status");
CREATE INDEX "Announcement_schoolId_status_scheduledAt_idx" ON "Announcement"("schoolId", "status", "scheduledAt");
CREATE INDEX "Announcement_schoolId_createdById_idx" ON "Announcement"("schoolId", "createdById");
CREATE INDEX "Announcement_schoolId_scope_status_idx" ON "Announcement"("schoolId", "scope", "status");

-- CreateTable
CREATE TABLE "AnnouncementTarget" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementTarget_announcementId_sectionId_key" ON "AnnouncementTarget"("announcementId", "sectionId");
CREATE INDEX "AnnouncementTarget_schoolId_sectionId_idx" ON "AnnouncementTarget"("schoolId", "sectionId");
CREATE INDEX "AnnouncementTarget_schoolId_classId_idx" ON "AnnouncementTarget"("schoolId", "classId");

-- CreateTable
CREATE TABLE "AnnouncementAudience" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "group" "AnnouncementAudienceGroup" NOT NULL,

    CONSTRAINT "AnnouncementAudience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementAudience_announcementId_group_key" ON "AnnouncementAudience"("announcementId", "group");
CREATE INDEX "AnnouncementAudience_announcementId_idx" ON "AnnouncementAudience"("announcementId");

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "actorType" "AnnouncementReadActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_actorType_actorId_key" ON "AnnouncementRead"("announcementId", "actorType", "actorId");
CREATE INDEX "AnnouncementRead_schoolId_actorType_actorId_idx" ON "AnnouncementRead"("schoolId", "actorType", "actorId");
CREATE INDEX "AnnouncementRead_announcementId_idx" ON "AnnouncementRead"("announcementId");

-- AddForeignKey
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: legacy audience population = exactly who could already see these
-- announcements (STUDENTS via /api/student/announcements, GUARDIANS via
-- /api/parent/announcements — both queried unfiltered-by-audience school-wide
-- rows). Uses md5(random()) ids to avoid depending on pgcrypto's
-- gen_random_uuid() being installed.
INSERT INTO "AnnouncementAudience" ("id", "announcementId", "group")
SELECT md5(random()::text || clock_timestamp()::text || a."id" || 'STUDENTS'), a."id", 'STUDENTS'
FROM "Announcement" a;

INSERT INTO "AnnouncementAudience" ("id", "announcementId", "group")
SELECT md5(random()::text || clock_timestamp()::text || a."id" || 'GUARDIANS'), a."id", 'GUARDIANS'
FROM "Announcement" a;
