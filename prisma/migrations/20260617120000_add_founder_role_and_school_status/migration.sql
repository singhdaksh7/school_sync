-- CreateEnum
CREATE TYPE "SchoolStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "School" ADD COLUMN "status" "SchoolStatus" NOT NULL DEFAULT 'ACTIVE';
