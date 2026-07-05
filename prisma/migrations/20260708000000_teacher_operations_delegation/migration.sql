-- CreateTable
CREATE TABLE "OperationalRoleAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE,
    "effectiveUntil" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalRoleAssignment_teacherId_idx" ON "OperationalRoleAssignment"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalRoleAssignment_schoolId_roleType_teacherId_key" ON "OperationalRoleAssignment"("schoolId", "roleType", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalRoleAssignment_schoolId_roleType_priority_key" ON "OperationalRoleAssignment"("schoolId", "roleType", "priority");

-- AddForeignKey
ALTER TABLE "OperationalRoleAssignment" ADD CONSTRAINT "OperationalRoleAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalRoleAssignment" ADD CONSTRAINT "OperationalRoleAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalRoleAssignment" ADD CONSTRAINT "OperationalRoleAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
