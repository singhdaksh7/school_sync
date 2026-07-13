import { prisma } from "@/lib/prisma";
import { gradeForPercentage } from "@/lib/report-cards";

export async function getStudentDashboardData(studentId: string, schoolId: string) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAhead = new Date(today);
  sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7);

  const [student, attendance, monthAttendance, homeworkStatuses, latestResults, latestReportCard, announcements, upcomingHolidays] =
    await Promise.all([
      prisma.student.findFirst({
        where: { id: studentId, schoolId },
        select: {
          id: true,
          name: true,
          rollNo: true,
          admissionNo: true,
          email: true,
          phone: true,
          section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
          school: { select: { id: true, name: true, slug: true, logoUrl: true } },
        },
      }),
      prisma.attendance.findMany({
        where: { studentId, schoolId, type: "STUDENT", date: { gte: thirtyDaysAgo } },
        orderBy: { date: "desc" },
      }),
      prisma.attendance.findMany({
        where: { studentId, schoolId, type: "STUDENT", date: { gte: startOfMonth } },
      }),
      prisma.homeworkStudentStatus.findMany({
        where: {
          studentId,
          student: { schoolId },
          homework: { schoolId, status: { not: "CANCELLED" }, dueDate: { gte: sevenDaysAgo } },
        },
        include: {
          homework: { include: { teacher: { select: { id: true, name: true } } } },
        },
        orderBy: { homework: { dueDate: "desc" } },
      }),
      prisma.examResult.findMany({
        where: {
          studentId,
          student: { schoolId },
          exam: { scheme: { schoolId } },
        },
        include: { exam: { include: { scheme: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.reportCard.findFirst({
        where: { schoolId, studentId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: { id: true, percentage: true, grade: true, totalMarks: true, publishedAt: true, examScheme: { select: { name: true } } },
      }),
      prisma.announcement.findMany({
        where: { schoolId },
        include: { createdBy: { select: { name: true, role: true } } },
        orderBy: { publishedAt: "desc" },
        take: 5,
      }),
      prisma.holiday.findMany({
        where: { schoolId, date: { gte: today, lte: sevenDaysAhead } },
        orderBy: { date: "asc" },
      }),
    ]);

  if (!student) return null;

  const summarize = (records: typeof attendance) => {
    let present = 0, absent = 0, late = 0;
    for (const r of records) {
      if (r.status === "PRESENT") present += 1;
      else if (r.status === "ABSENT") absent += 1;
      else if (r.status === "LATE") late += 1;
    }
    const total = records.length;
    const percentage = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
    return { present, absent, late, total, percentage };
  };

  const attendanceSummary = {
    last30Days: summarize(attendance),
    currentMonth: summarize(monthAttendance),
    recent: attendance.slice(0, 7),
  };

  const todayHomework = homeworkStatuses.filter((s) => {
    const due = new Date(s.homework.dueDate);
    due.setHours(0, 0, 0, 0);
    return due.getTime() === today.getTime();
  });

  const homeworkSummary = {
    todayCount: todayHomework.length,
    last7DaysCount: homeworkStatuses.length,
    today: todayHomework.map((s) => ({
      id: s.id,
      homeworkId: s.homeworkId,
      title: s.homework.title,
      subject: s.homework.subject,
      teacher: s.homework.teacher,
      dueDate: s.homework.dueDate,
    })),
  };

  const latestExamResults = latestResults.map((result) => {
    const percentage = result.exam.maxMarks > 0 ? (result.marks / result.exam.maxMarks) * 100 : 0;
    return {
      id: result.id,
      marks: result.marks,
      maxMarks: result.exam.maxMarks,
      grade: gradeForPercentage(percentage),
      exam: { id: result.exam.id, name: result.exam.name, scheme: result.exam.scheme },
    };
  });

  return {
    profile: student,
    attendanceSummary,
    homeworkSummary,
    latestResults: { latestExamResults, latestReportCard },
    announcements,
    upcomingEvents: upcomingHolidays.map((h) => ({ id: h.id, type: "HOLIDAY" as const, title: h.name, date: h.date })),
  };
}

export type StudentDashboardData = NonNullable<Awaited<ReturnType<typeof getStudentDashboardData>>>;
