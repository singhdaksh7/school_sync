-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "fatherPhone" TEXT,
ADD COLUMN     "fatherPhoneHash" TEXT,
ADD COLUMN     "motherName" TEXT,
ADD COLUMN     "motherPhone" TEXT,
ADD COLUMN     "motherPhoneHash" TEXT;

-- Backfill: copy the legacy single "parent" field into Father, since that's
-- the only reasonable default mapping without more information. Both remain
-- editable afterward. fatherPhoneHash is intentionally NOT backfilled here
-- (can't bcrypt-hash from raw SQL) — see the one-off Node backfill script.
UPDATE "Student"
SET "fatherName" = "parentName",
    "fatherPhone" = "parentPhone"
WHERE "parentName" IS NOT NULL OR "parentPhone" IS NOT NULL;
