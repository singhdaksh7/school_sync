-- AlterTable
ALTER TABLE "School" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "SchoolPeriodSchedule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "label" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isInstructional" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SchoolPeriodSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolPeriodSchedule_schoolId_idx" ON "SchoolPeriodSchedule"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPeriodSchedule_schoolId_periodNumber_key" ON "SchoolPeriodSchedule"("schoolId", "periodNumber");

-- CreateIndex
CREATE INDEX "Arrangement_schoolId_date_idx" ON "Arrangement"("schoolId", "date");

-- AddForeignKey
ALTER TABLE "SchoolPeriodSchedule" ADD CONSTRAINT "SchoolPeriodSchedule_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
