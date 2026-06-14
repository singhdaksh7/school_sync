import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { getTodayDateOnly, hasCutoffPassed, normalizeCutoffTime } from "@/lib/teacher-attendance";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherAuth.teacherId },
    include: { school: { select: { teacherAttendanceCutoffTime: true } } },
  });
  if (!teacher) return NextResponse.json({ error: "Teacher profile not found" }, { status: 404 });

  const date = getTodayDateOnly();
  const cutoffTime = normalizeCutoffTime(teacher.school.teacherAttendanceCutoffTime);
  const cutoffPassed = hasCutoffPassed(cutoffTime);

  const attendance = await prisma.attendance.findUnique({
    where: { date_teacherId: { date, teacherId: teacher.id } },
    select: { id: true, status: true, createdAt: true },
  });

  return NextResponse.json({
    date: date.toISOString(),
    cutoffTime,
    cutoffPassed,
    canMarkPresent: !attendance && !cutoffPassed,
    attendance,
  });
}
