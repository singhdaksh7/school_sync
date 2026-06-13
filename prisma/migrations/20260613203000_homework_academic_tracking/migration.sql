CREATE TYPE "HomeworkAcademicSubmissionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'LATE_SUBMITTED', 'NOT_SUBMITTED', 'CHECKED', 'REJECTED');
CREATE TYPE "HomeworkSubmissionMethod" AS ENUM ('NONE', 'ONLINE', 'PHYSICAL');

ALTER TABLE "Homework" ADD COLUMN "deadlineAt" TIMESTAMP(3);

UPDATE "Homework"
SET "deadlineAt" = "dueDate"
WHERE "deadlineAt" IS NULL;

ALTER TABLE "Homework" ALTER COLUMN "deadlineAt" SET NOT NULL;

ALTER TABLE "HomeworkStudentStatus"
  ADD COLUMN "submissionStatus" "HomeworkAcademicSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "submissionMethod" "HomeworkSubmissionMethod" NOT NULL DEFAULT 'NONE';

UPDATE "HomeworkStudentStatus"
SET "submissionStatus" = CASE "status"::text
  WHEN 'SUBMITTED' THEN 'SUBMITTED'::"HomeworkAcademicSubmissionStatus"
  WHEN 'LATE' THEN 'LATE_SUBMITTED'::"HomeworkAcademicSubmissionStatus"
  WHEN 'NOT_SUBMITTED' THEN 'NOT_SUBMITTED'::"HomeworkAcademicSubmissionStatus"
  WHEN 'CHECKED' THEN 'CHECKED'::"HomeworkAcademicSubmissionStatus"
  ELSE 'PENDING'::"HomeworkAcademicSubmissionStatus"
END;

ALTER TABLE "HomeworkSubmission"
  ADD COLUMN "submissionStatus" "HomeworkAcademicSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "submissionMethod" "HomeworkSubmissionMethod" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "checkedAt" TIMESTAMP(3);

ALTER TABLE "HomeworkSubmission" ALTER COLUMN "attachmentUrl" DROP NOT NULL;

UPDATE "HomeworkSubmission"
SET
  "submissionStatus" = CASE "status"::text
    WHEN 'SUBMITTED' THEN 'SUBMITTED'::"HomeworkAcademicSubmissionStatus"
    WHEN 'LATE' THEN 'LATE_SUBMITTED'::"HomeworkAcademicSubmissionStatus"
    WHEN 'REVIEWED' THEN 'CHECKED'::"HomeworkAcademicSubmissionStatus"
    WHEN 'REJECTED' THEN 'REJECTED'::"HomeworkAcademicSubmissionStatus"
    ELSE 'PENDING'::"HomeworkAcademicSubmissionStatus"
  END,
  "submissionMethod" = CASE
    WHEN "attachmentUrl" IS NOT NULL AND btrim("attachmentUrl") <> '' THEN 'ONLINE'::"HomeworkSubmissionMethod"
    ELSE 'NONE'::"HomeworkSubmissionMethod"
  END,
  "checkedAt" = CASE
    WHEN "status"::text IN ('REVIEWED', 'REJECTED') THEN "reviewedAt"
    ELSE NULL
  END;

CREATE INDEX "Homework_schoolId_deadlineAt_idx" ON "Homework"("schoolId", "deadlineAt");
CREATE INDEX "HomeworkSubmission_submissionStatus_idx" ON "HomeworkSubmission"("submissionStatus");
CREATE INDEX "HomeworkSubmission_submissionMethod_idx" ON "HomeworkSubmission"("submissionMethod");
