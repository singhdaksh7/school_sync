-- Add a nullable canonical link from TimetableSubjectRequirement to the
-- school's Master Subject catalogue (Subject). Nullable and additive only:
-- pre-existing free-text rows keep loading unchanged as legacy/unmapped
-- ("subjectId" IS NULL); nothing is deleted, renamed, or remapped.

-- AlterTable
ALTER TABLE "TimetableSubjectRequirement" ADD COLUMN "subjectId" TEXT;

-- CreateIndex
CREATE INDEX "TimetableSubjectRequirement_subjectId_idx" ON "TimetableSubjectRequirement"("subjectId");

-- CreateIndex
-- Postgres treats each NULL as distinct for a unique index, so any number of
-- legacy rows (subjectId IS NULL) may coexist per section without violating
-- this constraint; only canonical (non-null subjectId) rows are deduplicated.
CREATE UNIQUE INDEX "TimetableSubjectRequirement_sectionId_subjectId_key" ON "TimetableSubjectRequirement"("sectionId", "subjectId");

-- AddForeignKey
ALTER TABLE "TimetableSubjectRequirement" ADD CONSTRAINT "TimetableSubjectRequirement_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
