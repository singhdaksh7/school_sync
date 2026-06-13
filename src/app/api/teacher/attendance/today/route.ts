import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { getTodayDateOnly, hasCutoffPassed, normalizeCutoffTime } from "@/lib/teacher-attendance";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({
    where: { userId: session.user.id },
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
