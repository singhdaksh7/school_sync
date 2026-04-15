"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { GraduationCap, LogOut, CalendarDays, ClipboardCheck, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Slot {
  dayOfWeek: number;
  period: number;
  subject: string | null;
  sectionName: string;
  className: string;
}

interface TeacherProfile {
  id: string;
  name: string;
  school: { name: string };
}

export default function TeacherTimetablePage() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/teacher/me")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setProfile(d); });

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">SchoolSync</p>
            {profile && <p className="text-xs text-gray-400">{profile.school.name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {profile && (
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-800">{profile.name}</p>
              <p className="text-xs text-gray-400">Teacher Portal</p>
            </div>
          )}
          <Link href="/teacher/attendance">
            <Button variant="outline" size="sm" className="gap-2">
              <ClipboardCheck className="w-4 h-4" /> Attendance
            </Button>
          </Link>
          <Link href="/teacher/marks">
            <Button variant="outline" size="sm" className="gap-2">
              <FileText className="w-4 h-4" /> Marks
            </Button>
          </Link>
          <Link href="/teacher/arrangements">
            <Button variant="outline" size="sm" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Arrangements
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} className="gap-2 text-gray-500">
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Timetable</h1>
          <p className="text-sm text-gray-500 mt-1">Your weekly class schedule</p>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading...</div>
        ) : !hasAnySlot ? (
          <Card>
            <CardContent className="py-20 text-center">
              <CalendarDays className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-700 font-semibold text-lg">No timetable assigned yet</p>
              <p className="text-gray-400 text-sm mt-2">
                Your school admin has not assigned you any class periods. Please contact them.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-20 px-3 py-2.5 text-xs font-semibold text-gray-500 text-left bg-gray-50 border border-gray-200">
                    Period
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
                                Class {slot.className} – {slot.sectionName}
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
    </div>
  );
}
