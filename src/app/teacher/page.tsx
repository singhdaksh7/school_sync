"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays, BookOpenCheck, RefreshCw, ClipboardCheck,
  ArrowRight, Check, X, Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Slot { dayOfWeek: number; period: number; subject: string | null; sectionName: string; className: string }
interface HomeworkSubmission { status: string }
interface Homework { submissions: HomeworkSubmission[] }
interface Arrangement { id: string; date: string; period: number; section: { name: string; class: { name: string } }; absentTeacher: { name: string } }
type SelfStatus = "PRESENT" | "ABSENT" | "LATE";
interface SelfAttendance { attendance: { status: SelfStatus } | null; cutoffTime?: string }

const SELF_STATUS = {
  PRESENT: { label: "Present", icon: Check, color: "text-green-700 bg-green-50 border-green-200 dark:bg-green-950 dark:text-green-300" },
  ABSENT: { label: "Absent", icon: X, color: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:text-red-300" },
  LATE: { label: "Late", icon: Clock, color: "text-yellow-700 bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300" },
};

export default function TeacherDashboardPage() {
  const [profileName, setProfileName] = useState<string>("");
  const [todaySlots, setTodaySlots] = useState<Slot[]>([]);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [todaySubs, setTodaySubs] = useState<Arrangement[]>([]);
  const [self, setSelf] = useState<SelfAttendance | null>(null);

  useEffect(() => {
    fetch("/api/teacher/me").then((r) => r.json()).then((d) => { if (!d.error) setProfileName(d.name || ""); }).catch(() => {});

    fetch("/api/teacher/timetable").then((r) => r.json()).then((d) => {
      if (d.error) return;
      const jsDay = new Date().getDay(); // Sun=0 .. Sat=6 (timetable uses Mon=1..Sat=6)
      setTodaySlots((d.slots || []).filter((s: Slot) => s.dayOfWeek === jsDay).sort((a: Slot, b: Slot) => a.period - b.period));
    }).catch(() => {});

    fetch("/api/teacher/homework").then((r) => r.json()).then((d) => {
      if (d.error) return;
      const count = (d.homework || []).reduce((acc: number, hw: Homework) =>
        acc + hw.submissions.filter((s) => s.status === "SUBMITTED" || s.status === "LATE").length, 0);
      setPendingReviews(count);
    }).catch(() => {});

    fetch("/api/teacher/arrangements").then((r) => r.json()).then((d) => {
      if (!Array.isArray(d)) return;
      const today = new Date().toISOString().split("T")[0];
      setTodaySubs(d.filter((a: Arrangement) => a.date.split("T")[0] === today).sort((a: Arrangement, b: Arrangement) => a.period - b.period));
    }).catch(() => {});

    fetch("/api/teacher/attendance/today").then((r) => r.json()).then((d) => {
      if (!d.error) setSelf(d);
    }).catch(() => {});
  }, []);

  const selfStatus = self?.attendance?.status;
  const selfCfg = selfStatus ? SELF_STATUS[selfStatus] : null;

  const cards = [
    {
      label: "Today's Classes",
      value: todaySlots.length,
      hint: todaySlots.length ? `Next: P${todaySlots[0].period} · Class ${todaySlots[0].className}-${todaySlots[0].sectionName}` : "No classes scheduled today",
      icon: CalendarDays,
      href: "/teacher/timetable",
      accent: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400",
    },
    {
      label: "Pending Homework Reviews",
      value: pendingReviews,
      hint: pendingReviews ? "Submissions awaiting review" : "All caught up",
      icon: BookOpenCheck,
      href: "/teacher/homework",
      accent: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
    },
    {
      label: "Today's Substitutions",
      value: todaySubs.length,
      hint: todaySubs.length ? `In place of ${todaySubs[0].absentTeacher.name}` : "No arrangement duties today",
      icon: RefreshCw,
      href: "/teacher/arrangements",
      accent: "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {profileName ? `Welcome back, ${profileName.split(" ")[0]}` : "Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Here&apos;s what&apos;s happening today.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="group focus-visible:outline-none">
            <Card className="h-full transition-shadow group-hover:shadow-md dark:border-gray-800 dark:bg-gray-950">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", c.accent)}>
                    <c.icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-gray-500" />
                </div>
                <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-gray-100">{c.value}</p>
                <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300">{c.label}</p>
                <p className="mt-0.5 truncate text-xs text-gray-400">{c.hint}</p>
              </CardContent>
            </Card>
          </Link>
        ))}

        {/* Attendance Status */}
        <Link href="/teacher/attendance" className="group focus-visible:outline-none">
          <Card className="h-full transition-shadow group-hover:shadow-md dark:border-gray-800 dark:bg-gray-950">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  <ClipboardCheck className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-gray-500" />
              </div>
              <div className="mt-4 flex items-center gap-2">
                {selfCfg ? (
                  <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold", selfCfg.color)}>
                    <selfCfg.icon className="h-3.5 w-3.5" /> {selfCfg.label}
                  </span>
                ) : (
                  <span className="text-sm font-semibold italic text-gray-400">Not marked</span>
                )}
              </div>
              <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300">Attendance Status</p>
              <p className="mt-0.5 truncate text-xs text-gray-400">
                {self?.cutoffTime ? `Cutoff ${self.cutoffTime}` : "Your attendance today"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Today's schedule detail */}
      <Card className="dark:border-gray-800 dark:bg-gray-950">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Today&apos;s Classes</h2>
            <Link href="/teacher/timetable" className="text-xs font-medium text-blue-600 hover:text-blue-700">Full timetable</Link>
          </div>
          {todaySlots.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No classes scheduled for today.</p>
          ) : (
            <div className="space-y-2">
              {todaySlots.map((s) => (
                <div key={`${s.dayOfWeek}-${s.period}`} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 dark:border-gray-800">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    P{s.period}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">Class {s.className} – {s.sectionName}</p>
                    {s.subject && <p className="truncate text-xs text-gray-400">{s.subject}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
