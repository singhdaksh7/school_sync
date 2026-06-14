-- CreateTable
CREATE TABLE "TeacherCustomRole" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherCustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherPermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TeacherPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherRoleAssignment" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classIds" JSONB,
    "sectionIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherCustomRole_schoolId_idx" ON "TeacherCustomRole"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherCustomRole_schoolId_name_key" ON "TeacherCustomRole"("schoolId", "name");

-- CreateIndex
CREATE INDEX "TeacherPermission_roleId_idx" ON "TeacherPermission"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherPermission_roleId_module_action_key" ON "TeacherPermission"("roleId", "module", "action");

-- CreateIndex
CREATE INDEX "TeacherRoleAssignment_teacherId_idx" ON "TeacherRoleAssignment"("teacherId");

-- CreateIndex
CREATE INDEX "TeacherRoleAssignment_roleId_idx" ON "TeacherRoleAssignment"("roleId");

-- CreateIndex
CREATE INDEX "TeacherRoleAssignment_schoolId_idx" ON "TeacherRoleAssignment"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherRoleAssignment_teacherId_roleId_key" ON "TeacherRoleAssignment"("teacherId", "roleId");

-- AddForeignKey
ALTER TABLE "TeacherCustomRole" ADD CONSTRAINT "TeacherCustomRole_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherPermission" ADD CONSTRAINT "TeacherPermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "TeacherCustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherRoleAssignment" ADD CONSTRAINT "TeacherRoleAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherRoleAssignment" ADD CONSTRAINT "TeacherRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "TeacherCustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherRoleAssignment" ADD CONSTRAINT "TeacherRoleAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
