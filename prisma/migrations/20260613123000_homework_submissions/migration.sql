CREATE TYPE "HomeworkSubmissionStatus" AS ENUM ('SUBMITTED', 'LATE', 'REVIEWED', 'REJECTED');

CREATE TABLE "HomeworkSubmission" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "homeworkId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "guardianId" TEXT,
  "attachmentUrl" TEXT NOT NULL,
  "fileName" TEXT,
  "fileType" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "HomeworkSubmissionStatus" NOT NULL,
  "teacherRemark" TEXT,
  "score" DOUBLE PRECISION,
  "maxScore" DOUBLE PRECISION,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HomeworkSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeworkSubmission_homeworkId_studentId_key" ON "HomeworkSubmission"("homeworkId", "studentId");
CREATE INDEX "HomeworkSubmission_schoolId_idx" ON "HomeworkSubmission"("schoolId");
CREATE INDEX "HomeworkSubmission_homeworkId_idx" ON "HomeworkSubmission"("homeworkId");
CREATE INDEX "HomeworkSubmission_studentId_idx" ON "HomeworkSubmission"("studentId");
CREATE INDEX "HomeworkSubmission_status_idx" ON "HomeworkSubmission"("status");

ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "Homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;
