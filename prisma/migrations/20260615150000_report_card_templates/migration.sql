-- CreateTable
CREATE TABLE "ReportCardTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "assignedClassIds" JSONB,
    "layoutType" TEXT NOT NULL DEFAULT 'CLASSIC',
    "paperSize" TEXT NOT NULL DEFAULT 'A4_PORTRAIT',
    "logoUrl" TEXT,
    "principalSignatureUrl" TEXT,
    "classTeacherSignatureEnabled" BOOLEAN NOT NULL DEFAULT true,
    "stampUrl" TEXT,
    "watermarkText" TEXT,
    "backgroundImageUrl" TEXT,
    "footerText" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "showAttendance" BOOLEAN NOT NULL DEFAULT true,
    "showRank" BOOLEAN NOT NULL DEFAULT false,
    "showGrade" BOOLEAN NOT NULL DEFAULT true,
    "showRemarks" BOOLEAN NOT NULL DEFAULT true,
    "showSubjectTeacherRemarks" BOOLEAN NOT NULL DEFAULT true,
    "showClassTeacherRemarks" BOOLEAN NOT NULL DEFAULT true,
    "showCoCurricular" BOOLEAN NOT NULL DEFAULT false,
    "showSkills" BOOLEAN NOT NULL DEFAULT false,
    "showDiscipline" BOOLEAN NOT NULL DEFAULT false,
    "showAwards" BOOLEAN NOT NULL DEFAULT false,
    "showCustomFields" BOOLEAN NOT NULL DEFAULT false,
    "gradeBands" JSONB,
    "subjectGroups" JSONB,
    "customSections" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCardTemplate_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ReportCard" ADD COLUMN "templateId" TEXT;
ALTER TABLE "ReportCard" ADD COLUMN "templateSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "ReportCardTemplate_schoolId_idx" ON "ReportCardTemplate"("schoolId");
CREATE INDEX "ReportCardTemplate_schoolId_isDefault_idx" ON "ReportCardTemplate"("schoolId", "isDefault");
CREATE INDEX "ReportCard_templateId_idx" ON "ReportCard"("templateId");

-- AddForeignKey
ALTER TABLE "ReportCardTemplate" ADD CONSTRAINT "ReportCardTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportCardTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
