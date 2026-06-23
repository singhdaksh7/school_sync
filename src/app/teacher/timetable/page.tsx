"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/LanguageContext";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Slot {
  dayOfWeek: number;
  period: number;
  subject: string | null;
  sectionName: string;
  className: string;
}

export default function TeacherTimetablePage() {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/teacher/timetable")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setSlots(d.slots || []);
          setPeriodsPerDay(d.periodsPerDay || 6);
        }
        setLoading(false);
      });
  }, []);

  function getSlot(day: number, period: number): Slot | undefined {
    return slots.find((s) => s.dayOfWeek === day && s.period === period);
  }

  const hasAnySlot = slots.length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("teacherTimetable.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("teacherTimetable.subtitle")}</p>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">{t("common.loading")}</div>
        ) : !hasAnySlot ? (
          <Card>
            <CardContent className="py-20 text-center">
              <CalendarDays className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-700 font-semibold text-lg">{t("teacherTimetable.noTimetable")}</p>
              <p className="text-gray-400 text-sm mt-2">
                {t("teacherTimetable.noTimetableHint")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-20 px-3 py-2.5 text-xs font-semibold text-gray-500 text-left bg-gray-50 border border-gray-200">
                    {t("teacherTimetable.period")}
                  </th>
                  {DAYS.map((d) => (
                    <th
                      key={d}
                      className="px-3 py-2.5 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 text-center min-w-[130px]"
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: periodsPerDay }, (_, i) => i + 1).map((period) => (
                  <tr key={period}>
                    <td className="px-3 py-2.5 text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 text-center">
                      P{period}
                    </td>
                    {DAYS.map((_, di) => {
                      const day = di + 1;
                      const slot = getSlot(day, period);
                      return (
                        <td key={day} className="border border-gray-200 p-1.5">
                          {slot ? (
                            <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 min-h-[52px]">
                              <p className="text-xs font-semibold text-blue-800">
                                {t("teacherTimetable.classSection", { className: slot.className, sectionName: slot.sectionName })}
                              </p>
                              {slot.subject && (
                                <p className="text-xs text-blue-500 mt-0.5">{slot.subject}</p>
                              )}
                            </div>
                          ) : (
                            <div className="min-h-[52px] rounded-md flex items-center justify-center">
                              <span className="text-xs text-gray-300">—</span>
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
