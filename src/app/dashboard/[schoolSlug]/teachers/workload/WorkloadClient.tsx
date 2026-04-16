"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Users, BookOpen, AlertTriangle, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DAY_NAMES: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

interface TeacherWorkload {
  id: string; name: string; email: string | null; subject: string | null;
  periodsPerWeek: number; sections: string[]; subjects: string[];
  perDay: Record<number, number>; busiestDay: number; busiestCount: number; isMentor: boolean;
}

function WorkloadBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", pct > 80 ? "bg-red-400" : pct > 50 ? "bg-orange-400" : "bg-blue-400")} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-600 w-6 text-right">{value}</span>
    </div>
  );
}

interface Props { initialWorkload: TeacherWorkload[] }

export default function WorkloadClient({ initialWorkload }: Props) {
  const router = useRouter();
  const workload = initialWorkload;

  const maxPeriods = Math.max(...workload.map((t) => t.periodsPerWeek), 1);
  const avgPeriods = workload.length > 0 ? Math.round(workload.reduce((s, t) => s + t.periodsPerWeek, 0) / workload.length) : 0;
  const overloaded = workload.filter((t) => t.periodsPerWeek > avgPeriods * 1.5);
  const underloaded = workload.filter((t) => t.periodsPerWeek === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 text-gray-500 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-900">Teacher Workload</h2>
          <p className="text-sm text-gray-500 mt-0.5">Periods per week across all teachers</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-gray-500">Total Teachers</p><p className="text-2xl font-bold text-gray-900">{workload.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-gray-500">Avg Periods/Week</p><p className="text-2xl font-bold text-gray-900">{avgPeriods}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><div className="flex items-center gap-2"><AlertTriangle className={cn("w-4 h-4", overloaded.length > 0 ? "text-orange-500" : "text-gray-300")} /><div><p className="text-xs text-gray-500">Overloaded</p><p className="text-2xl font-bold text-gray-900">{overloaded.length}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><div className="flex items-center gap-2"><TrendingDown className={cn("w-4 h-4", underloaded.length > 0 ? "text-blue-400" : "text-gray-300")} /><div><p className="text-xs text-gray-500">No Timetable</p><p className="text-2xl font-bold text-gray-900">{underloaded.length}</p></div></div></CardContent></Card>
      </div>

      {workload.length === 0 ? (
        <Card><CardContent className="py-20 text-center"><Users className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500 font-medium">No teachers found</p></CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">All Teachers — Sorted by Load</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-0 divide-y divide-gray-50">
              {[...workload].sort((a, b) => b.periodsPerWeek - a.periodsPerWeek).map((t) => (
                <div key={t.id} className="py-4 flex items-start gap-4">
                  <div className="w-9 h-9 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 font-semibold text-sm flex-shrink-0">
                    {t.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                      {t.subject && <span className="text-xs text-gray-400">{t.subject}</span>}
                      {t.isMentor && <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">Mentor</Badge>}
                      {t.periodsPerWeek > avgPeriods * 1.5 && <Badge variant="outline" className="text-xs bg-orange-50 text-orange-600 border-orange-200">Overloaded</Badge>}
                      {t.periodsPerWeek === 0 && <Badge variant="outline" className="text-xs bg-gray-50 text-gray-400 border-gray-200">No timetable</Badge>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-28 flex-shrink-0">Periods/week</span>
                      <WorkloadBar value={t.periodsPerWeek} max={maxPeriods} />
                    </div>
                    {t.periodsPerWeek > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[1, 2, 3, 4, 5, 6].map((day) => {
                          const count = t.perDay[day] || 0;
                          return (
                            <div key={day} className={cn("flex flex-col items-center text-[10px] rounded px-1.5 py-1 min-w-[32px]",
                              count === 0 ? "bg-gray-50 text-gray-300" : count >= 3 ? "bg-orange-50 text-orange-700" : "bg-blue-50 text-blue-700"
                            )}>
                              <span className="font-bold">{count}</span>
                              <span>{DAY_NAMES[day]}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {t.sections.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <BookOpen className="w-3 h-3 text-gray-300 flex-shrink-0" />
                        {t.sections.map((s) => <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{s}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
