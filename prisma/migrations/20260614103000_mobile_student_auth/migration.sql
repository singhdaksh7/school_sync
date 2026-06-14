ALTER TABLE "Student" ADD COLUMN "admissionNo" TEXT;
ALTER TABLE "Student" ADD COLUMN "passwordHash" TEXT;

CREATE UNIQUE INDEX "Student_schoolId_admissionNo_key" ON "Student"("schoolId", "admissionNo");
