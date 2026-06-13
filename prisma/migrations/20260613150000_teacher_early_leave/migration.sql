-- CreateTable
CREATE TABLE "TeacherEarlyLeaveRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "leaveAfterPeriod" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherEarlyLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherEarlyLeaveRequest_schoolId_status_idx" ON "TeacherEarlyLeaveRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "TeacherEarlyLeaveRequest_schoolId_date_idx" ON "TeacherEarlyLeaveRequest"("schoolId", "date");

-- CreateIndex
CREATE INDEX "TeacherEarlyLeaveRequest_teacherId_idx" ON "TeacherEarlyLeaveRequest"("teacherId");

-- AddForeignKey
ALTER TABLE "TeacherEarlyLeaveRequest" ADD CONSTRAINT "TeacherEarlyLeaveRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEarlyLeaveRequest" ADD CONSTRAINT "TeacherEarlyLeaveRequest_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEarlyLeaveRequest" ADD CONSTRAINT "TeacherEarlyLeaveRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
