import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { getTodayDateOnly, hasCutoffPassed, normalizeCutoffTime } from "@/lib/teacher-attendance";

export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherAuth.teacherId },
    include: { school: { select: { teacherAttendanceCutoffTime: true } } },
  });
  if (!teacher) return NextResponse.json({ error: "Teacher profile not found" }, { status: 404 });

  const date = getTodayDateOnly();
  const existing = await prisma.attendance.findUnique({
    where: { date_teacherId: { date, teacherId: teacher.id } },
    select: { id: true, status: true, createdAt: true },
  });

  if (existing) {
    if (existing.status === "PRESENT") {
      return NextResponse.json({ success: true, attendance: existing });
    }

    return NextResponse.json(
      { error: `Attendance is already marked ${existing.status.toLowerCase().replace("_", " ")}` },
      { status: 400 }
    );
  }

  const cutoffTime = normalizeCutoffTime(teacher.school.teacherAttendanceCutoffTime);
  if (hasCutoffPassed(cutoffTime)) {
    return NextResponse.json({ error: "Teacher attendance cutoff has passed" }, { status: 400 });
  }

  const attendance = await prisma.attendance.create({
    data: {
      date,
      type: "TEACHER",
      status: "PRESENT",
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      markedById: teacherAuth.userId,
    },
    select: { id: true, status: true, createdAt: true },
  });

  return NextResponse.json({ success: true, attendance });
}
