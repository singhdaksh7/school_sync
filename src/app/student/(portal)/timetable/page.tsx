"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/LanguageContext";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Slot {
  id: string;
  dayOfWeek: number;
  period: number;
  subject: string | null;
  teacher: { id: string; name: string } | null;
}

export default function StudentTimetablePage() {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [today, setToday] = useState<Slot[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"today" | "week">("today");

  useEffect(() => {
    fetch("/api/student/timetable")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setSlots(d.timetable || []);
          setToday(d.today || []);
          setDayOfWeek(d.dayOfWeek || 1);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const periodsPerDay = useMemo(() => Math.max(6, ...slots.map((s) => s.period)), [slots]);

  function getSlot(day: number, period: number) {
    return slots.find((s) => s.dayOfWeek === day && s.period === period);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("studentTimetable.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("studentTimetable.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {(["today", "week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                view === v ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {v === "today" ? t("studentTimetable.today") : t("studentTimetable.weekly")}
            </button>
          ))}
        </div>
      </div>

      {view === "today" ? (
        today.length === 0 ? (
          <Card className="border-border">
            <CardContent className="py-16 text-center">
              <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 font-medium text-foreground">{t("studentTimetable.noPeriodsToday")}</p>
              {dayOfWeek === 7 && <p className="mt-1 text-sm text-muted-foreground">{t("studentTimetable.sundayOff")}</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {[...today].sort((a, b) => a.period - b.period).map((slot) => (
              <Card key={slot.id} className="border-border">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                    P{slot.period}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{slot.subject || t("studentTimetable.freePeriod")}</p>
                    {slot.teacher && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" /> {slot.teacher.name}
                      </p>
                    )}
                  </div>
                  <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-16 border border-border bg-muted/50 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">{t("studentTimetable.period")}</th>
                {DAYS.map((d, i) => (
                  <th
                    key={d}
                    className={`min-w-[130px] border border-border px-3 py-2.5 text-center text-xs font-semibold text-foreground ${
                      i + 1 === dayOfWeek ? "bg-primary/10" : "bg-muted/50"
                    }`}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: periodsPerDay }, (_, i) => i + 1).map((period) => (
                <tr key={period}>
                  <td className="border border-border bg-muted/50 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground">P{period}</td>
                  {DAYS.map((_, di) => {
                    const day = di + 1;
                    const slot = getSlot(day, period);
                    return (
                      <td key={day} className="border border-border p-1.5">
                        {slot ? (
                          <div className="min-h-[52px] rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                            <p className="text-xs font-semibold text-foreground">{slot.subject || "—"}</p>
                            {slot.teacher && <p className="mt-0.5 text-xs text-muted-foreground">{slot.teacher.name}</p>}
                          </div>
                        ) : (
                          <div className="flex min-h-[52px] items-center justify-center rounded-md">
                            <span className="text-xs text-muted-foreground/40">—</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
