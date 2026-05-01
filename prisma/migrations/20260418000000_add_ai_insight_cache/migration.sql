-- CreateTable
CREATE TABLE "AIInsightCache" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "insights" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsightCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AIInsightCache_schoolId_key" ON "AIInsightCache"("schoolId");

-- AddForeignKey
ALTER TABLE "AIInsightCache" ADD CONSTRAINT "AIInsightCache_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
