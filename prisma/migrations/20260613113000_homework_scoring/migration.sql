CREATE TYPE "HomeworkStatus" AS ENUM ('ACTIVE', 'CLOSED', 'CANCELLED');
CREATE TYPE "HomeworkStudentSubmissionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'NOT_SUBMITTED', 'LATE', 'CHECKED');

CREATE TABLE "Homework" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "attachmentUrl" TEXT,
  "status" "HomeworkStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Homework_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeworkStudentStatus" (
  "id" TEXT NOT NULL,
  "homeworkId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "status" "HomeworkStudentSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "submittedAt" TIMESTAMP(3),
  "score" DOUBLE PRECISION,
  "maxScore" DOUBLE PRECISION,
  "teacherRemark" TEXT,
  "parentVisible" BOOLEAN NOT NULL DEFAULT true,
  "checkedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HomeworkStudentStatus_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Homework_schoolId_dueDate_idx" ON "Homework"("schoolId", "dueDate");
CREATE INDEX "Homework_schoolId_status_idx" ON "Homework"("schoolId", "status");
CREATE INDEX "Homework_sectionId_subject_idx" ON "Homework"("sectionId", "subject");
CREATE INDEX "Homework_teacherId_idx" ON "Homework"("teacherId");

CREATE UNIQUE INDEX "HomeworkStudentStatus_homeworkId_studentId_key" ON "HomeworkStudentStatus"("homeworkId", "studentId");
CREATE INDEX "HomeworkStudentStatus_studentId_idx" ON "HomeworkStudentStatus"("studentId");
CREATE INDEX "HomeworkStudentStatus_status_idx" ON "HomeworkStudentStatus"("status");

ALTER TABLE "Homework" ADD CONSTRAINT "Homework_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeworkStudentStatus" ADD CONSTRAINT "HomeworkStudentStatus_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "Homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkStudentStatus" ADD CONSTRAINT "HomeworkStudentStatus_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
