"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isTomorrow, isFuture, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface Arrangement {
  id: string;
  date: string;
  period: number;
  subject: string | null;
  dayOfWeek: number;
  absentTeacher: { name: string; subject: string | null };
  section: { name: string; class: { name: string } };
}

const DAY_KEYS = ["", "common.days.monday", "common.days.tuesday", "common.days.wednesday", "common.days.thursday", "common.days.friday", "common.days.saturday"];

type DateKind = "today" | "tomorrow" | "upcoming" | "past";

const BADGE_KEY: Record<DateKind, string> = {
  today: "teacherArrangements.badgeToday",
  tomorrow: "teacherArrangements.badgeTomorrow",
  upcoming: "teacherArrangements.badgeUpcoming",
  past: "teacherArrangements.badgePast",
};

function dateLabel(dateStr: string): { label: string; kind: DateKind; badgeColor: string } {
  const d = new Date(dateStr);
  if (isToday(d)) return { label: format(d, "dd MMM yyyy"), kind: "today", badgeColor: "bg-blue-100 text-blue-700" };
  if (isTomorrow(d)) return { label: format(d, "dd MMM yyyy"), kind: "tomorrow", badgeColor: "bg-purple-100 text-purple-700" };
  if (isFuture(d)) return { label: format(d, "dd MMM yyyy"), kind: "upcoming", badgeColor: "bg-green-100 text-green-700" };
  return { label: format(d, "dd MMM yyyy"), kind: "past", badgeColor: "bg-gray-100 text-gray-500" };
}

export default function TeacherArrangementsPage() {
  const { t } = useTranslation();
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
            <h1 className="text-2xl font-bold text-gray-900">{t("teacherArrangements.title")}</h1>
            <p className="text-sm text-gray-500 mt-1">{t("teacherArrangements.subtitle")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchArrangements} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> {t("teacherArrangements.refresh")}
          </Button>
        </div>

        {/* Today's duties highlight */}
        {hasToday && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-blue-600" />
              <p className="text-sm font-semibold text-blue-800">{t("teacherArrangements.todaysDuties")}</p>
            </div>
            <div className="space-y-2">
              {todayArrangements.map((a) => (
                <div key={a.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-3 border border-blue-100">
                  <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    P{a.period}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {t("teacherArrangements.classSection", { className: a.section.class.name, sectionName: a.section.name })}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t("teacherArrangements.subjectInPlaceOf", { subject: a.subject || a.absentTeacher.subject || t("teacherArrangements.subjectNotSpecified"), teacher: a.absentTeacher.name })}
                    </p>
                  </div>
                  <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">{t("teacherArrangements.periodLabel", { period: a.period })}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-400">{t("common.loading")}</div>
        ) : arrangements.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <RefreshCw className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">{t("teacherArrangements.noArrangements")}</p>
              <p className="text-gray-400 text-sm mt-1">{t("teacherArrangements.noArrangementsHint")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([dateKey, dayArrangements]) => {
                const { label, kind, badgeColor } = dateLabel(dateKey + "T00:00:00");
                return (
                  <div key={dateKey}>
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", badgeColor)}>{t(BADGE_KEY[kind])}</span>
                      <span className="text-xs text-gray-400">{t(DAY_KEYS[dayArrangements[0].dayOfWeek])}</span>
                    </div>
                    <div className="space-y-2">
                      {dayArrangements
                        .sort((a, b) => a.period - b.period)
                        .map((a) => (
                          <div key={a.id} className={cn(
                            "flex items-center justify-between px-4 py-3 rounded-lg border",
                            kind === "past" ? "bg-gray-50 border-gray-100" : "bg-white border-gray-200"
                          )}>
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0",
                                kind === "today" ? "bg-blue-600 text-white" : kind === "past" ? "bg-gray-100 text-gray-500" : "bg-blue-50 text-blue-700"
                              )}>
                                P{a.period}
                              </div>
                              <div>
                                <p className={cn("font-medium text-sm", kind === "past" ? "text-gray-400" : "text-gray-900")}>
                                  {t("teacherArrangements.classSection", { className: a.section.class.name, sectionName: a.section.name })}
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {t("teacherArrangements.subjectInPlaceOf", { subject: a.subject || a.absentTeacher.subject || "—", teacher: a.absentTeacher.name })}
                                </p>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs text-gray-500">{t("teacherArrangements.periodLabel", { period: a.period })}</Badge>
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
