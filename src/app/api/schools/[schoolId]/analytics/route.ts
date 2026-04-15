import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { subDays, startOfDay, format } from "date-fns";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const today = startOfDay(new Date());
  const thirtyDaysAgo = subDays(today, 30);
  const sevenDaysAgo = subDays(today, 6);

  // Parallel data fetching
  const [
    totalStudents,
    totalTeachers,
    todayAttendance,
    last7DaysAttendance,
    last30DaysStudentAttendance,
    allExamResults,
  ] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.teacher.count({ where: { schoolId } }),
    prisma.attendance.findMany({
      where: { schoolId, date: today, type: "STUDENT" },
      select: { status: true },
    }),
    prisma.attendance.findMany({
      where: { schoolId, type: "STUDENT", date: { gte: sevenDaysAgo, lte: today } },
      select: { date: true, status: true },
    }),
    prisma.attendance.findMany({
      where: { schoolId, type: "STUDENT", date: { gte: thirtyDaysAgo, lte: today } },
      include: { student: { select: { id: true, name: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } } } },
    }),
    prisma.examResult.findMany({
      where: { exam: { scheme: { schoolId } } },
      include: {
        student: { select: { id: true, name: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
        exam: { select: { maxMarks: true } },
      },
    }),
  ]);

  // Today attendance rate
  const todayPresent = todayAttendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const todayRate = todayAttendance.length > 0 ? Math.round((todayPresent / todayAttendance.length) * 100) : null;

  // Last 7 days trend — one entry per day
  const trend: { date: string; present: number; absent: number; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = subDays(today, i);
    const dayStr = format(d, "yyyy-MM-dd");
    const dayRecords = last7DaysAttendance.filter((a) => format(new Date(a.date), "yyyy-MM-dd") === dayStr);
    trend.push({
      date: format(d, "EEE dd"),
      present: dayRecords.filter((a) => a.status === "PRESENT" || a.status === "LATE").length,
      absent: dayRecords.filter((a) => a.status === "ABSENT").length,
      total: dayRecords.length,
    });
  }

  // At-risk students (< 75% attendance over last 30 days)
  const studentAttMap = new Map<string, { present: number; total: number; student: any }>();
  for (const record of last30DaysStudentAttendance) {
    if (!record.student) continue;
    const entry = studentAttMap.get(record.student.id) || { present: 0, total: 0, student: record.student };
    entry.total += 1;
    if (record.status === "PRESENT" || record.status === "LATE") entry.present += 1;
    studentAttMap.set(record.student.id, entry);
  }
  const atRisk = Array.from(studentAttMap.values())
    .filter((e) => e.total >= 5 && e.present / e.total < 0.75)
    .map((e) => ({
      id: e.student.id,
      name: e.student.name,
      rollNo: e.student.rollNo,
      section: e.student.section,
      attendanceRate: Math.round((e.present / e.total) * 100),
      presentDays: e.present,
      totalDays: e.total,
    }))
    .sort((a, b) => a.attendanceRate - b.attendanceRate)
    .slice(0, 10);

  // Top/bottom performers by average marks percentage
  const studentMarks = new Map<string, { totalPct: number; count: number; student: any }>();
  for (const result of allExamResults) {
    const pct = (result.marks / result.exam.maxMarks) * 100;
    const entry = studentMarks.get(result.student.id) || { totalPct: 0, count: 0, student: result.student };
    entry.totalPct += pct;
    entry.count += 1;
    studentMarks.set(result.student.id, entry);
  }
  const performers = Array.from(studentMarks.values())
    .map((e) => ({
      id: e.student.id,
      name: e.student.name,
      rollNo: e.student.rollNo,
      section: e.student.section,
      avgPct: Math.round(e.totalPct / e.count),
    }))
    .sort((a, b) => b.avgPct - a.avgPct);

  return NextResponse.json({
    totalStudents,
    totalTeachers,
    todayRate,
    todayMarked: todayAttendance.length,
    trend,
    atRisk,
    topPerformers: performers.slice(0, 5),
    bottomPerformers: performers.slice(-5).reverse(),
  });
}
