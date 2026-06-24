-- AlterEnum
ALTER TYPE "FeatureFlagKey" ADD VALUE 'NOTEBOOK_CHECKING';

-- AlterTable
ALTER TABLE "HomeworkStudentStatus" ADD COLUMN     "markedAt" TIMESTAMP(3),
ADD COLUMN     "markedByTeacherId" TEXT;

-- CreateTable
CREATE TABLE "ExamMilestone" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookCheck" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "examMilestoneId" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamMilestone_schoolId_idx" ON "ExamMilestone"("schoolId");

-- CreateIndex
CREATE INDEX "ExamMilestone_schoolId_active_idx" ON "ExamMilestone"("schoolId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ExamMilestone_schoolId_name_key" ON "ExamMilestone"("schoolId", "name");

-- CreateIndex
CREATE INDEX "NotebookCheck_schoolId_idx" ON "NotebookCheck"("schoolId");

-- CreateIndex
CREATE INDEX "NotebookCheck_teacherId_idx" ON "NotebookCheck"("teacherId");

-- CreateIndex
CREATE INDEX "NotebookCheck_examMilestoneId_idx" ON "NotebookCheck"("examMilestoneId");

-- CreateIndex
CREATE INDEX "NotebookCheck_schoolId_studentId_idx" ON "NotebookCheck"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookCheck_studentId_subject_examMilestoneId_key" ON "NotebookCheck"("studentId", "subject", "examMilestoneId");

-- CreateIndex
CREATE INDEX "HomeworkStudentStatus_markedByTeacherId_idx" ON "HomeworkStudentStatus"("markedByTeacherId");

-- AddForeignKey
ALTER TABLE "HomeworkStudentStatus" ADD CONSTRAINT "HomeworkStudentStatus_markedByTeacherId_fkey" FOREIGN KEY ("markedByTeacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamMilestone" ADD CONSTRAINT "ExamMilestone_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookCheck" ADD CONSTRAINT "NotebookCheck_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookCheck" ADD CONSTRAINT "NotebookCheck_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookCheck" ADD CONSTRAINT "NotebookCheck_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookCheck" ADD CONSTRAINT "NotebookCheck_examMilestoneId_fkey" FOREIGN KEY ("examMilestoneId") REFERENCES "ExamMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
