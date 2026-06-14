CREATE TYPE "ReportCardStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "ReportCard" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "examSchemeId" TEXT NOT NULL,
    "generatedByTeacherId" TEXT NOT NULL,
    "status" "ReportCardStatus" NOT NULL DEFAULT 'DRAFT',
    "classTeacherRemark" TEXT,
    "attendanceSummary" TEXT NOT NULL,
    "totalMarks" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReportCardSubject" (
    "id" TEXT NOT NULL,
    "reportCardId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "subjectTeacherRemark" TEXT,

    CONSTRAINT "ReportCardSubject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportCard_studentId_examSchemeId_key" ON "ReportCard"("studentId", "examSchemeId");
CREATE INDEX "ReportCard_schoolId_status_idx" ON "ReportCard"("schoolId", "status");
CREATE INDEX "ReportCard_schoolId_sectionId_examSchemeId_idx" ON "ReportCard"("schoolId", "sectionId", "examSchemeId");
CREATE INDEX "ReportCard_generatedByTeacherId_idx" ON "ReportCard"("generatedByTeacherId");
CREATE UNIQUE INDEX "ReportCardSubject_reportCardId_subject_key" ON "ReportCardSubject"("reportCardId", "subject");

ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_examSchemeId_fkey" FOREIGN KEY ("examSchemeId") REFERENCES "ExamScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_generatedByTeacherId_fkey" FOREIGN KEY ("generatedByTeacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardSubject" ADD CONSTRAINT "ReportCardSubject_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
