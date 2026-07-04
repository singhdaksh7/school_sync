import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { subDays, startOfDay, format } from "date-fns";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

const PRESENT_STATUSES = new Set(["PRESENT", "LATE"]);

/** Sums counts across all statuses for a group-by bucket key. */
function sumCounts(rows: { count: number }[]) {
  return rows.reduce((sum, r) => sum + r.count, 0);
}

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "ANALYTICS");
    if (denied) return denied;
  }

  const today = startOfDay(new Date());
  const thirtyDaysAgo = subDays(today, 30);
  const sevenDaysAgo = subDays(today, 6);

  // Every count below is a database-side aggregate (count/groupBy/raw SQL
  // AVG) — never a full table scan of attendance/exam-result rows hydrated
  // into JS. Per-student rows are one summary row per student, not one row
  // per attendance record or per exam result.
  const [
    totalStudents,
    totalTeachers,
    todayByStatus,
    trendByDateStatus,
    attendanceByStudentStatus,
    examPerformanceByStudent,
  ] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.teacher.count({ where: { schoolId } }),
    prisma.attendance.groupBy({
      by: ["status"],
      where: { schoolId, date: today, type: "STUDENT" },
      _count: { _all: true },
    }),
    prisma.attendance.groupBy({
      by: ["date", "status"],
      where: { schoolId, type: "STUDENT", date: { gte: sevenDaysAgo, lte: today } },
      _count: { _all: true },
    }),
    prisma.attendance.groupBy({
      by: ["studentId", "status"],
      where: { schoolId, type: "STUDENT", date: { gte: thirtyDaysAgo, lte: today }, studentId: { not: null } },
      _count: { _all: true },
    }),
    // Percentage-per-exam varies by exam.maxMarks, so the "average of each
    // exam's percentage" business metric needs a join — done once, in SQL,
    // returning ONE row per student (not one row per exam result).
    prisma.$queryRaw<{ studentId: string; avgPct: number }[]>`
      SELECT er."studentId" AS "studentId",
             AVG(er.marks / e."maxMarks" * 100) AS "avgPct"
      FROM "ExamResult" er
      JOIN "Exam" e ON er."examId" = e.id
      JOIN "ExamScheme" sc ON e."schemeId" = sc.id
      WHERE sc."schoolId" = ${schoolId} AND e."maxMarks" > 0
      GROUP BY er."studentId"
    `,
  ]);

  // ── Today's attendance rate ─────────────────────────────────────────────
  const todayTotal = sumCounts(todayByStatus.map((r) => ({ count: r._count._all })));
  const todayPresent = sumCounts(
    todayByStatus.filter((r) => PRESENT_STATUSES.has(r.status)).map((r) => ({ count: r._count._all }))
  );
  const todayRate = todayTotal > 0 ? Math.round((todayPresent / todayTotal) * 100) : null;

  // ── Last 7 days trend (bounded to 7 buckets, not one row per record) ────
  const trendBuckets = new Map<string, { present: number; absent: number; total: number }>();
  for (const row of trendByDateStatus) {
    const key = format(new Date(row.date), "yyyy-MM-dd");
    const bucket = trendBuckets.get(key) ?? { present: 0, absent: 0, total: 0 };
    bucket.total += row._count._all;
    if (PRESENT_STATUSES.has(row.status)) bucket.present += row._count._all;
    if (row.status === "ABSENT") bucket.absent += row._count._all;
    trendBuckets.set(key, bucket);
  }
  const trend: { date: string; present: number; absent: number; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = subDays(today, i);
    const key = format(d, "yyyy-MM-dd");
    const bucket = trendBuckets.get(key) ?? { present: 0, absent: 0, total: 0 };
    trend.push({ date: format(d, "EEE dd"), ...bucket });
  }

  // ── At-risk students (< 75% attendance over last 30 days) ──────────────
  // One aggregate row per (student, status) — bounded by distinct students,
  // never by the number of attendance records in the window.
  const perStudentAttendance = new Map<string, { present: number; total: number }>();
  for (const row of attendanceByStudentStatus) {
    if (!row.studentId) continue;
    const entry = perStudentAttendance.get(row.studentId) ?? { present: 0, total: 0 };
    entry.total += row._count._all;
    if (PRESENT_STATUSES.has(row.status)) entry.present += row._count._all;
    perStudentAttendance.set(row.studentId, entry);
  }
  const atRiskCandidates = Array.from(perStudentAttendance.entries())
    .map(([studentId, e]) => ({ studentId, ...e, rate: e.present / e.total }))
    .filter((e) => e.total >= 5 && e.rate < 0.75)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 10);

  // ── Top/bottom performers by average exam percentage ────────────────────
  const performerCandidates = examPerformanceByStudent
    .map((r) => ({ studentId: r.studentId, avgPct: Math.round(Number(r.avgPct)) }))
    .sort((a, b) => b.avgPct - a.avgPct);
  const topIds = performerCandidates.slice(0, 5);
  const bottomIds = performerCandidates.slice(-5).reverse();

  // Hydrate names/section only for the small, already-shortlisted student set.
  const neededStudentIds = [
    ...new Set([...atRiskCandidates.map((c) => c.studentId), ...topIds.map((c) => c.studentId), ...bottomIds.map((c) => c.studentId)]),
  ];
  const studentDetails = neededStudentIds.length
    ? await prisma.student.findMany({
        where: { id: { in: neededStudentIds }, schoolId },
        select: { id: true, name: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } },
      })
    : [];
  const detailById = new Map(studentDetails.map((s) => [s.id, s]));

  const atRisk = atRiskCandidates
    .map((c) => {
      const student = detailById.get(c.studentId);
      if (!student) return null;
      return {
        id: student.id,
        name: student.name,
        rollNo: student.rollNo,
        section: student.section,
        attendanceRate: Math.round(c.rate * 100),
        presentDays: c.present,
        totalDays: c.total,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const toPerformer = (c: { studentId: string; avgPct: number }) => {
    const student = detailById.get(c.studentId);
    if (!student) return null;
    return { id: student.id, name: student.name, rollNo: student.rollNo, section: student.section, avgPct: c.avgPct };
  };
  const topPerformers = topIds.map(toPerformer).filter((v): v is NonNullable<typeof v> => v !== null);
  const bottomPerformers = bottomIds.map(toPerformer).filter((v): v is NonNullable<typeof v> => v !== null);

  return NextResponse.json({
    totalStudents,
    totalTeachers,
    todayRate,
    todayMarked: todayTotal,
    trend,
    atRisk,
    topPerformers,
    bottomPerformers,
  });
}
