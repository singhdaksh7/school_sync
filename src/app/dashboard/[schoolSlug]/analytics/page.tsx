import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  BarChart2, Users, GraduationCap, AlertTriangle,
  TrendingUp, TrendingDown, ExternalLink, Flame, BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { subDays, startOfDay, format } from "date-fns";
import { cn } from "@/lib/utils";
import AIInsightCard from "./AIInsightCard";

function getGrade(pct: number) {
  if (pct >= 90) return { label: "A+", color: "text-green-600" };
  if (pct >= 75) return { label: "A", color: "text-green-500" };
  if (pct >= 60) return { label: "B", color: "text-blue-600" };
  if (pct >= 45) return { label: "C", color: "text-yellow-600" };
  return { label: "D", color: "text-red-600" };
}

function AttendanceBar({ pct, colorClass }: { pct: number; colorClass: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", colorClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-600 w-8 text-right">{pct}%</span>
    </div>
  );
}

function HeatCell({ rate }: { rate: number }) {
  const bg =
    rate >= 90 ? "bg-green-500" :
    rate >= 75 ? "bg-green-300" :
    rate >= 60 ? "bg-yellow-300" :
    rate >= 45 ? "bg-orange-400" :
    "bg-red-500";
  return (
    <div className={cn("w-full h-8 rounded flex items-center justify-center text-xs font-semibold text-white", bg)}>
      {rate}%
    </div>
  );
}

// Linear regression to predict next-N-day attendance rate
function predictAttendance(dailyRates: { rate: number }[], daysAhead: number): number | null {
  const valid = dailyRates.filter((d) => d.rate !== null);
  if (valid.length < 3) return null;
  const n = valid.length;
  const xs = valid.map((_, i) => i);
  const ys = valid.map((d) => d.rate);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0) / xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const intercept = yMean - slope * xMean;
  return Math.min(100, Math.max(0, Math.round(intercept + slope * (n + daysAhead - 1))));
}

// Combined risk score: attendance (50%) + academic (35%) + leaves (15%)
function computeRiskScore(attRate: number | null, avgMarks: number | null, leaveFreq: number): number {
  const attScore = attRate !== null ? (100 - attRate) : 50; // higher absence = higher risk
  const acadScore = avgMarks !== null ? (100 - avgMarks) : 50;
  const leaveScore = Math.min(leaveFreq * 20, 100);
  return Math.round(attScore * 0.5 + acadScore * 0.35 + leaveScore * 0.15);
}

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const schoolId = school.id;
  const today = startOfDay(new Date());
  const thirtyDaysAgo = subDays(today, 30);
  const sevenDaysAgo = subDays(today, 6);

  const [
    totalStudents,
    totalTeachers,
    todayAttendance,
    last7DaysAttendance,
    last30DaysStudentAttendance,
    allExamResults,
    allSections,
    allLeaves,
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
      include: {
        student: {
          select: {
            id: true, name: true, rollNo: true,
            section: { select: { id: true, name: true, class: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.examResult.findMany({
      where: { exam: { scheme: { schoolId } } },
      include: {
        student: {
          select: {
            id: true, name: true, rollNo: true,
            section: { select: { name: true, class: { select: { name: true } } } },
          },
        },
        exam: { select: { maxMarks: true } },
      },
    }),
    prisma.section.findMany({
      where: { class: { schoolId } },
      include: { class: { select: { name: true } } },
    }),
    prisma.leaveRequest.findMany({
      where: { schoolId, type: "STUDENT" },
      select: { studentId: true, status: true, createdAt: true },
    }),
  ]);

  // ─── Today summary ──────────────────────────────────────────────────────────
  const todayPresent = todayAttendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const todayRate = todayAttendance.length > 0 ? Math.round((todayPresent / todayAttendance.length) * 100) : null;

  // ─── 7-day trend ────────────────────────────────────────────────────────────
  const trend: { date: string; present: number; absent: number; total: number; rate: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = subDays(today, i);
    const dayStr = format(d, "yyyy-MM-dd");
    const dayRecords = last7DaysAttendance.filter((a) => format(new Date(a.date), "yyyy-MM-dd") === dayStr);
    const p = dayRecords.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
    trend.push({
      date: format(d, "EEE dd"),
      present: p,
      absent: dayRecords.filter((a) => a.status === "ABSENT").length,
      total: dayRecords.length,
      rate: dayRecords.length > 0 ? Math.round((p / dayRecords.length) * 100) : 0,
    });
  }

  // ─── Attendance prediction ───────────────────────────────────────────────────
  const trendWithData = trend.filter((t) => t.total > 0);
  const predicted7 = predictAttendance(trendWithData.map((t) => ({ rate: t.rate })), 7);
  const predicted3 = predictAttendance(trendWithData.map((t) => ({ rate: t.rate })), 3);

  const last7Avg = trendWithData.length > 0 ? Math.round(trendWithData.reduce((s, t) => s + t.rate, 0) / trendWithData.length) : null;
  const trendDir = predicted7 !== null && last7Avg !== null
    ? predicted7 > last7Avg + 2 ? "up" : predicted7 < last7Avg - 2 ? "down" : "flat"
    : "flat";

  // ─── Per-student attendance map ──────────────────────────────────────────────
  const studentAttMap = new Map<string, { present: number; total: number; student: typeof last30DaysStudentAttendance[0]["student"] }>();
  for (const record of last30DaysStudentAttendance) {
    if (!record.student) continue;
    const entry = studentAttMap.get(record.student.id) || { present: 0, total: 0, student: record.student };
    entry.total++;
    if (record.status === "PRESENT" || record.status === "LATE") entry.present++;
    studentAttMap.set(record.student.id, entry);
  }

  const atRisk = Array.from(studentAttMap.values())
    .filter((e) => e.total >= 5 && e.present / e.total < 0.75)
    .map((e) => ({
      id: e.student!.id,
      name: e.student!.name,
      rollNo: e.student!.rollNo,
      section: e.student!.section,
      attendanceRate: Math.round((e.present / e.total) * 100),
    }))
    .sort((a, b) => a.attendanceRate - b.attendanceRate)
    .slice(0, 10);

  // ─── Per-student marks map ───────────────────────────────────────────────────
  const studentMarks = new Map<string, { totalPct: number; count: number; student: typeof allExamResults[0]["student"] }>();
  for (const result of allExamResults) {
    if (!result.exam.maxMarks) continue;
    const pct = (result.marks / result.exam.maxMarks) * 100;
    const entry = studentMarks.get(result.student.id) || { totalPct: 0, count: 0, student: result.student };
    entry.totalPct += pct;
    entry.count++;
    studentMarks.set(result.student.id, entry);
  }

  const performers = Array.from(studentMarks.values())
    .map((e) => ({ id: e.student.id, name: e.student.name, rollNo: e.student.rollNo, section: e.student.section, avgPct: Math.round(e.totalPct / e.count) }))
    .sort((a, b) => b.avgPct - a.avgPct);
  const topPerformers = performers.slice(0, 5);
  const bottomPerformers = performers.slice(-5).reverse();

  // ─── Section heatmap ─────────────────────────────────────────────────────────
  const sectionAttMap = new Map<string, { present: number; total: number }>();
  for (const record of last30DaysStudentAttendance) {
    if (!record.student?.section) continue;
    const key = record.student.section.id;
    const e = sectionAttMap.get(key) || { present: 0, total: 0 };
    e.total++;
    if (record.status === "PRESENT" || record.status === "LATE") e.present++;
    sectionAttMap.set(key, e);
  }
  const sectionHeatmap = allSections
    .map((s) => {
      const data = sectionAttMap.get(s.id);
      const rate = data && data.total >= 5 ? Math.round((data.present / data.total) * 100) : null;
      return { id: s.id, label: `${s.class.name}-${s.name}`, rate };
    })
    .filter((s) => s.rate !== null)
    .sort((a, b) => a.label.localeCompare(b.label)) as { id: string; label: string; rate: number }[];

  // ─── Enhanced risk score list ─────────────────────────────────────────────────
  const studentLeaveCount = new Map<string, number>();
  for (const leave of allLeaves) {
    if (leave.studentId) studentLeaveCount.set(leave.studentId, (studentLeaveCount.get(leave.studentId) || 0) + 1);
  }

  const enhancedRisk = Array.from(studentAttMap.values())
    .filter((e) => e.total >= 5)
    .map((e) => {
      const sid = e.student!.id;
      const attRate = Math.round((e.present / e.total) * 100);
      const marksData = studentMarks.get(sid);
      const avgMarks = marksData ? Math.round(marksData.totalPct / marksData.count) : null;
      const leaves = studentLeaveCount.get(sid) || 0;
      const riskScore = computeRiskScore(attRate, avgMarks, leaves);
      return { id: sid, name: e.student!.name, rollNo: e.student!.rollNo, section: e.student!.section, attRate, avgMarks, riskScore };
    })
    .filter((s) => s.riskScore >= 40)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8);

  const maxTrendTotal = Math.max(...trend.map((t) => t.total), 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
        <p className="text-sm text-gray-500 mt-1">School performance overview</p>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                <GraduationCap className="w-4 h-4 text-blue-600" />
              </div>
              <div><p className="text-xs text-gray-500">Students</p><p className="text-2xl font-bold text-gray-900">{totalStudents}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                <Users className="w-4 h-4 text-purple-600" />
              </div>
              <div><p className="text-xs text-gray-500">Teachers</p><p className="text-2xl font-bold text-gray-900">{totalTeachers}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", todayRate === null ? "bg-gray-100" : todayRate >= 75 ? "bg-green-100" : "bg-red-100")}>
                <BarChart2 className={cn("w-4 h-4", todayRate === null ? "text-gray-400" : todayRate >= 75 ? "text-green-600" : "text-red-600")} />
              </div>
              <div><p className="text-xs text-gray-500">Today's Attendance</p><p className="text-2xl font-bold text-gray-900">{todayRate !== null ? `${todayRate}%` : "—"}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", atRisk.length > 0 ? "bg-orange-100" : "bg-green-100")}>
                <AlertTriangle className={cn("w-4 h-4", atRisk.length > 0 ? "text-orange-600" : "text-green-600")} />
              </div>
              <div><p className="text-xs text-gray-500">At-Risk Students</p><p className="text-2xl font-bold text-gray-900">{atRisk.length}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── AI Insights ── */}
      <AIInsightCard schoolId={schoolId} />

      {/* ── 7-day trend + prediction ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">7-Day Attendance Trend</CardTitle>
            {predicted7 !== null && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-gray-400">Predicted</span>
                <span className={cn("flex items-center gap-1 font-semibold",
                  trendDir === "up" ? "text-green-600" : trendDir === "down" ? "text-red-600" : "text-blue-600"
                )}>
                  {trendDir === "up" ? <TrendingUp className="w-3.5 h-3.5" /> : trendDir === "down" ? <TrendingDown className="w-3.5 h-3.5" /> : null}
                  {predicted3 !== null && <span>3d: {predicted3}%</span>}
                  <span className="text-gray-300 mx-0.5">|</span>
                  <span>7d: {predicted7}%</span>
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {trend.every((t) => t.total === 0) ? (
            <p className="text-sm text-gray-400 py-4 text-center">No attendance data in the last 7 days</p>
          ) : (
            <div className="flex items-end gap-2 h-36 mt-2">
              {trend.map((t, i) => {
                const presentH = t.total > 0 ? Math.round((t.present / maxTrendTotal) * 120) : 0;
                const absentH = t.total > 0 ? Math.round((t.absent / maxTrendTotal) * 120) : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="flex flex-col-reverse w-full gap-0.5" style={{ height: 120 }}>
                      {t.total > 0 ? (
                        <>
                          <div className="w-full bg-green-400 rounded-t-sm" style={{ height: presentH }} title={`Present: ${t.present}`} />
                          <div className="w-full bg-red-300 rounded-t-sm" style={{ height: absentH }} title={`Absent: ${t.absent}`} />
                        </>
                      ) : (
                        <div className="w-full bg-gray-100 rounded-sm" style={{ height: 4 }} />
                      )}
                    </div>
                    {t.total > 0 && <p className="text-[10px] font-medium text-gray-500">{t.rate}%</p>}
                    <p className="text-[10px] text-gray-400 text-center leading-tight">{t.date}</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-4 mt-3 justify-end">
            <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 bg-green-400 rounded-sm" /> Present</div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-3 bg-red-300 rounded-sm" /> Absent</div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section Heatmap ── */}
      {sectionHeatmap.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-500" />
              Section Attendance Heatmap
              <span className="text-xs text-gray-400 font-normal">(last 30 days)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-2">
              {sectionHeatmap.map((s) => (
                <div key={s.id} className="flex flex-col gap-1">
                  <HeatCell rate={s.rate} />
                  <p className="text-[10px] text-gray-500 text-center truncate">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-3 justify-end flex-wrap">
              {[["≥90%","bg-green-500"],["75–89%","bg-green-300"],["60–74%","bg-yellow-300"],["45–59%","bg-orange-400"],["<45%","bg-red-500"]].map(([label, bg]) => (
                <div key={label} className="flex items-center gap-1 text-[10px] text-gray-500">
                  <div className={cn("w-3 h-3 rounded-sm", bg)} /> {label}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Enhanced risk + performers ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* At-Risk (simple) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              At-Risk Students
              <span className="text-xs text-gray-400 font-normal">(&lt;75% in last 30 days)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {atRisk.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No at-risk students</p>
            ) : (
              <div className="space-y-3">
                {atRisk.map((s) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-orange-700 font-semibold text-xs flex-shrink-0">
                      {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{s.section?.class.name}-{s.section?.name}</span>
                      </div>
                      <AttendanceBar pct={s.attendanceRate} colorClass={s.attendanceRate < 60 ? "bg-red-400" : "bg-orange-400"} />
                    </div>
                    <Link href={`/dashboard/${schoolSlug}/students/${s.id}`}>
                      <ExternalLink className="w-3.5 h-3.5 text-gray-300 hover:text-blue-500" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Enhanced Risk Score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="w-4 h-4 text-red-500" />
              Combined Risk Score
              <span className="text-xs text-gray-400 font-normal">(attendance + marks + leaves)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {enhancedRisk.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No high-risk students detected</p>
            ) : (
              <div className="space-y-3">
                {enhancedRisk.map((s) => {
                  const riskColor = s.riskScore >= 70 ? "bg-red-500" : s.riskScore >= 55 ? "bg-orange-400" : "bg-yellow-400";
                  const textColor = s.riskScore >= 70 ? "text-red-600" : s.riskScore >= 55 ? "text-orange-600" : "text-yellow-600";
                  return (
                    <div key={s.id} className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0", riskColor)}>
                        {s.riskScore}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                          <span className="text-xs text-gray-400 flex-shrink-0">{s.section?.class.name}-{s.section?.name}</span>
                        </div>
                        <div className="flex gap-3 mt-0.5">
                          <span className="text-[11px] text-gray-500">Att: <span className={s.attRate < 75 ? "text-red-500 font-medium" : ""}>{s.attRate}%</span></span>
                          {s.avgMarks !== null && <span className="text-[11px] text-gray-500">Marks: <span className={s.avgMarks < 50 ? "text-red-500 font-medium" : ""}>{s.avgMarks}%</span></span>}
                        </div>
                      </div>
                      <Link href={`/dashboard/${schoolSlug}/students/${s.id}`}>
                        <ExternalLink className="w-3.5 h-3.5 text-gray-300 hover:text-blue-500" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Performers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-500" />
              Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {topPerformers.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No exam data yet</p>
            ) : (
              <div className="space-y-3">
                {topPerformers.map((s, i) => {
                  const grade = getGrade(s.avgPct);
                  return (
                    <div key={s.id} className="flex items-center gap-3">
                      <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
                        i === 0 ? "bg-yellow-100 text-yellow-700" : i === 1 ? "bg-gray-100 text-gray-500" : "bg-orange-50 text-orange-600"
                      )}>#{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                          <span className="text-xs text-gray-400 flex-shrink-0">{s.section?.class.name}-{s.section?.name}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                          <div className="h-full bg-green-400 rounded-full" style={{ width: `${s.avgPct}%` }} />
                        </div>
                      </div>
                      <span className={cn("text-sm font-bold flex-shrink-0", grade.color)}>{grade.label} {s.avgPct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Needs Attention */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Needs Attention
              <span className="text-xs text-gray-400 font-normal">(lowest average marks)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {bottomPerformers.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No exam data yet</p>
            ) : (
              <div className="space-y-3">
                {bottomPerformers.map((s) => {
                  const grade = getGrade(s.avgPct);
                  return (
                    <div key={s.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-red-50 rounded-full flex items-center justify-center text-red-600 font-semibold text-xs flex-shrink-0">
                        {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                          <span className="text-xs text-gray-400 flex-shrink-0">{s.section?.class.name}-{s.section?.name}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                          <div className={cn("h-full rounded-full", s.avgPct < 45 ? "bg-red-400" : "bg-yellow-400")} style={{ width: `${s.avgPct}%` }} />
                        </div>
                      </div>
                      <span className={cn("text-sm font-bold flex-shrink-0", grade.color)}>{grade.label} {s.avgPct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
