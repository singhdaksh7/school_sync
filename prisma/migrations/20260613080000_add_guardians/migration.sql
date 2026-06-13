-- CreateTable
CREATE TABLE "Guardian" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGuardian" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'GUARDIAN',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentGuardian_pkey" PRIMARY KEY ("id")
);

-- Backfill guardian rows from legacy student parent fields.
-- Passwords remain NULL, so backfilled guardians cannot log in until an admin sets a password.
INSERT INTO "Guardian" ("id", "schoolId", "name", "phone", "email", "passwordHash", "createdAt", "updatedAt")
WITH raw_guardians AS (
    SELECT
        "schoolId",
        trim("parentName") AS "parentName",
        regexp_replace("parentPhone", '\D', '', 'g') AS digits
    FROM "Student"
    WHERE "parentPhone" IS NOT NULL AND trim("parentPhone") <> ''
),
normalized_guardians AS (
    SELECT
        "schoolId",
        "parentName",
        CASE
            WHEN length(digits) = 10 THEN '+91' || digits
            WHEN length(digits) = 11 AND left(digits, 1) = '0' THEN '+91' || substring(digits from 2)
            WHEN length(digits) = 12 AND left(digits, 2) = '91' THEN '+' || digits
            ELSE digits
        END AS phone
    FROM raw_guardians
    WHERE digits <> ''
)
SELECT
    'guardian_' || md5("schoolId" || ':' || phone),
    "schoolId",
    COALESCE(NULLIF(MIN("parentName"), ''), 'Guardian'),
    phone,
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM normalized_guardians
WHERE phone <> ''
GROUP BY "schoolId", phone;

-- Backfill links from students to the guardians created above.
INSERT INTO "StudentGuardian" ("id", "schoolId", "studentId", "guardianId", "relationType", "isPrimary", "createdAt", "updatedAt")
SELECT
    'student_guardian_' || md5(s."id" || ':' || g."id"),
    s."schoolId",
    s."id",
    g."id",
    'GUARDIAN',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Student" s
JOIN "Guardian" g
  ON g."schoolId" = s."schoolId"
 AND g."phone" = CASE
      WHEN length(regexp_replace(s."parentPhone", '\D', '', 'g')) = 10 THEN '+91' || regexp_replace(s."parentPhone", '\D', '', 'g')
      WHEN length(regexp_replace(s."parentPhone", '\D', '', 'g')) = 11 AND left(regexp_replace(s."parentPhone", '\D', '', 'g'), 1) = '0' THEN '+91' || substring(regexp_replace(s."parentPhone", '\D', '', 'g') from 2)
      WHEN length(regexp_replace(s."parentPhone", '\D', '', 'g')) = 12 AND left(regexp_replace(s."parentPhone", '\D', '', 'g'), 2) = '91' THEN '+' || regexp_replace(s."parentPhone", '\D', '', 'g')
      ELSE regexp_replace(s."parentPhone", '\D', '', 'g')
    END
WHERE s."parentPhone" IS NOT NULL AND trim(s."parentPhone") <> '';

-- CreateIndex
CREATE UNIQUE INDEX "Guardian_schoolId_phone_key" ON "Guardian"("schoolId", "phone");

-- CreateIndex
CREATE INDEX "Guardian_schoolId_idx" ON "Guardian"("schoolId");

-- CreateIndex
CREATE INDEX "Guardian_phone_idx" ON "Guardian"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "StudentGuardian_studentId_guardianId_key" ON "StudentGuardian"("studentId", "guardianId");

-- CreateIndex
CREATE INDEX "StudentGuardian_schoolId_studentId_idx" ON "StudentGuardian"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "StudentGuardian_schoolId_guardianId_idx" ON "StudentGuardian"("schoolId", "guardianId");

-- CreateIndex
CREATE INDEX "StudentGuardian_guardianId_idx" ON "StudentGuardian"("guardianId");

-- AddForeignKey
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;
