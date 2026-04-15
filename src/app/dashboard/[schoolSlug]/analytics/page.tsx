"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { BarChart2, Users, GraduationCap, AlertTriangle, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TrendEntry { date: string; present: number; absent: number; total: number }
interface PersonEntry { id: string; name: string; rollNo: string; section: { name: string; class: { name: string } }; attendanceRate?: number; presentDays?: number; totalDays?: number; avgPct?: number }
interface Analytics {
  totalStudents: number;
  totalTeachers: number;
  todayRate: number | null;
  todayMarked: number;
  trend: TrendEntry[];
  atRisk: PersonEntry[];
  topPerformers: PersonEntry[];
  bottomPerformers: PersonEntry[];
}

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
        <div className={cn("h-full rounded-full transition-all", colorClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-600 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const params = useParams();
  const schoolSlug = params.schoolSlug as string;
  const [schoolId, setSchoolId] = useState("");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/school-by-slug/${schoolSlug}`).then((r) => r.json()).then((d) => {
      setSchoolId(d.id);
      fetch(`/api/schools/${d.id}/analytics`).then((r) => r.json()).then((a) => {
        setData(a);
        setLoading(false);
      });
    });
  }, [schoolSlug]);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading analytics...</div>;
  if (!data) return null;

  const maxTrendTotal = Math.max(...data.trend.map((t) => t.total), 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
        <p className="text-sm text-gray-500 mt-1">School performance overview</p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                <GraduationCap className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Students</p>
                <p className="text-2xl font-bold text-gray-900">{data.totalStudents}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                <Users className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Teachers</p>
                <p className="text-2xl font-bold text-gray-900">{data.totalTeachers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center",
                data.todayRate === null ? "bg-gray-100" : data.todayRate >= 75 ? "bg-green-100" : "bg-red-100"
              )}>
                <BarChart2 className={cn("w-4 h-4", data.todayRate === null ? "text-gray-400" : data.todayRate >= 75 ? "text-green-600" : "text-red-600")} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Today's Attendance</p>
                <p className="text-2xl font-bold text-gray-900">
                  {data.todayRate !== null ? `${data.todayRate}%` : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", data.atRisk.length > 0 ? "bg-orange-100" : "bg-green-100")}>
                <AlertTriangle className={cn("w-4 h-4", data.atRisk.length > 0 ? "text-orange-600" : "text-green-600")} />
              </div>
              <div>
                <p className="text-xs text-gray-500">At-Risk Students</p>
                <p className="text-2xl font-bold text-gray-900">{data.atRisk.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 7-day attendance trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">7-Day Attendance Trend</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {data.trend.every((t) => t.total === 0) ? (
            <p className="text-sm text-gray-400 py-4 text-center">No attendance data in the last 7 days</p>
          ) : (
            <div className="flex items-end gap-2 h-36 mt-2">
              {data.trend.map((t, i) => {
                const presentH = t.total > 0 ? Math.round((t.present / maxTrendTotal) * 120) : 0;
                const absentH = t.total > 0 ? Math.round((t.absent / maxTrendTotal) * 120) : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="flex flex-col-reverse w-full gap-0.5" style={{ height: 120 }}>
                      {t.total > 0 ? (
                        <>
                          <div className="w-full bg-green-400 rounded-t-sm transition-all" style={{ height: presentH }} title={`Present: ${t.present}`} />
                          <div className="w-full bg-red-300 rounded-t-sm transition-all" style={{ height: absentH }} title={`Absent: ${t.absent}`} />
                        </>
                      ) : (
                        <div className="w-full bg-gray-100 rounded-sm" style={{ height: 4 }} />
                      )}
                    </div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* At-risk students */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              At-Risk Students
              <span className="text-xs text-gray-400 font-normal ml-1">(&lt;75% in last 30 days)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.atRisk.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No at-risk students</p>
            ) : (
              <div className="space-y-3">
                {data.atRisk.map((s) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-orange-700 font-semibold text-xs flex-shrink-0">
                      {s.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{s.section?.class.name}-{s.section?.name}</span>
                      </div>
                      <AttendanceBar pct={s.attendanceRate!} colorClass={s.attendanceRate! < 60 ? "bg-red-400" : "bg-orange-400"} />
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

        {/* Top performers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-500" />
              Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.topPerformers.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No exam data yet</p>
            ) : (
              <div className="space-y-3">
                {data.topPerformers.map((s, i) => {
                  const grade = getGrade(s.avgPct!);
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

        {/* Bottom performers */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Needs Attention
              <span className="text-xs text-gray-400 font-normal ml-1">(lowest average marks)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.bottomPerformers.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No exam data yet</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.bottomPerformers.map((s) => {
                  const grade = getGrade(s.avgPct!);
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
                          <div className={cn("h-full rounded-full", s.avgPct! < 45 ? "bg-red-400" : "bg-yellow-400")} style={{ width: `${s.avgPct}%` }} />
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
