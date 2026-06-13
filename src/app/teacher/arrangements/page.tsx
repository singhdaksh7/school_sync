"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isTomorrow, isFuture, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";

interface Arrangement {
  id: string;
  date: string;
  period: number;
  subject: string | null;
  dayOfWeek: number;
  absentTeacher: { name: string; subject: string | null };
  section: { name: string; class: { name: string } };
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dateLabel(dateStr: string): { label: string; badge: string; badgeColor: string } {
  const d = new Date(dateStr);
  if (isToday(d)) return { label: format(d, "dd MMM yyyy"), badge: "Today", badgeColor: "bg-blue-100 text-blue-700" };
  if (isTomorrow(d)) return { label: format(d, "dd MMM yyyy"), badge: "Tomorrow", badgeColor: "bg-purple-100 text-purple-700" };
  if (isFuture(d)) return { label: format(d, "dd MMM yyyy"), badge: "Upcoming", badgeColor: "bg-green-100 text-green-700" };
  return { label: format(d, "dd MMM yyyy"), badge: "Past", badgeColor: "bg-gray-100 text-gray-500" };
}

export default function TeacherArrangementsPage() {
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArrangements = useCallback(() => {
    setLoading(true);
    fetch("/api/teacher/arrangements")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setArrangements(d); setLoading(false); });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(fetchArrangements, 0);
    return () => window.clearTimeout(id);
  }, [fetchArrangements]);

  // Group by date
  const grouped = arrangements.reduce((acc, a) => {
    const key = a.date.split("T")[0];
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {} as Record<string, Arrangement[]>);

  const today = startOfDay(new Date()).toISOString().split("T")[0];
  const todayArrangements = grouped[today] || [];
  const hasToday = todayArrangements.length > 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Arrangements</h1>
            <p className="text-sm text-gray-500 mt-1">Classes assigned to you when a colleague is on leave</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchArrangements} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {/* Today's duties highlight */}
        {hasToday && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-blue-600" />
              <p className="text-sm font-semibold text-blue-800">Today&apos;s Arrangement Duties</p>
            </div>
            <div className="space-y-2">
              {todayArrangements.map((a) => (
                <div key={a.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-3 border border-blue-100">
                  <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    P{a.period}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      Class {a.section.class.name} – Section {a.section.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {a.subject || a.absentTeacher.subject || "Subject not specified"} ·{" "}
                      In place of <span className="font-medium">{a.absentTeacher.name}</span>
                    </p>
                  </div>
                  <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">Period {a.period}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading...</div>
        ) : arrangements.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <RefreshCw className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No arrangements assigned</p>
              <p className="text-gray-400 text-sm mt-1">You&apos;ll see duties here when a colleague&apos;s leave is approved</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([dateKey, dayArrangements]) => {
                const { label, badge, badgeColor } = dateLabel(dateKey + "T00:00:00");
                return (
                  <div key={dateKey}>
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", badgeColor)}>{badge}</span>
                      <span className="text-xs text-gray-400">{DAY_NAMES[dayArrangements[0].dayOfWeek]}</span>
                    </div>
                    <div className="space-y-2">
                      {dayArrangements
                        .sort((a, b) => a.period - b.period)
                        .map((a) => (
                          <div key={a.id} className={cn(
                            "flex items-center justify-between px-4 py-3 rounded-lg border",
                            badge === "Past" ? "bg-gray-50 border-gray-100" : "bg-white border-gray-200"
                          )}>
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0",
                                badge === "Today" ? "bg-blue-600 text-white" : badge === "Past" ? "bg-gray-100 text-gray-500" : "bg-blue-50 text-blue-700"
                              )}>
                                P{a.period}
                              </div>
                              <div>
                                <p className={cn("font-medium text-sm", badge === "Past" ? "text-gray-400" : "text-gray-900")}>
                                  Class {a.section.class.name} – Section {a.section.name}
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {a.subject || a.absentTeacher.subject || "—"} · In place of {a.absentTeacher.name}
                                </p>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs text-gray-500">Period {a.period}</Badge>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
    </div>
  );
}
