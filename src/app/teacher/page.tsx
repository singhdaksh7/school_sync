"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays, BookOpenCheck, RefreshCw, ClipboardCheck,
  ArrowRight, Check, X, Clock, DoorOpen, Award, ArrowUpRight, ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { TEACHER_NAV_ITEMS } from "@/components/teacher/TeacherSidebar";

/**
 * Maps a subset of TEACHER_NAV_ITEMS hrefs to the PERMISSION_CATALOG module
 * they're gated by for Operational/Delegated Teachers (teachers WITH at
 * least one TeacherRoleAssignment — see src/lib/teacher-permissions.ts).
 * Routes not listed here (timetable, arrangements, early-leave, leaves,
 * profile) are self-service/always-on and are never gated.
 */
const MODULE_GATE: Record<string, string> = {
  "/teacher/attendance": "ATTENDANCE",
  "/teacher/marks": "MARKS",
  "/teacher/report-cards": "REPORT_CARDS",
  "/teacher/homework": "HOMEWORK",
  "/teacher/notebook": "NOTEBOOK",
};

interface PermissionPair { module: string; action: string }

interface Slot { dayOfWeek: number; period: number; subject: string | null; sectionName: string; className: string }
interface HomeworkSubmission { status: string }
interface Homework { submissions: HomeworkSubmission[] }
interface Arrangement { id: string; date: string; period: number; section: { name: string; class: { name: string } }; absentTeacher: { name: string } }
type SelfStatus = "PRESENT" | "ABSENT" | "LATE";
interface SelfAttendance { attendance: { status: SelfStatus } | null; cutoffTime?: string }

const SELF_STATUS = {
  PRESENT: { labelKey: "common.present", icon: Check, color: "text-green-700 bg-green-50 border-green-200 dark:bg-green-950 dark:text-green-300" },
  ABSENT: { labelKey: "common.absent", icon: X, color: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950 dark:text-red-300" },
  LATE: { labelKey: "common.late", icon: Clock, color: "text-yellow-700 bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300" },
};

function greeting(t: (key: string) => string) {
  const h = new Date().getHours();
  return h < 12 ? t("teacherDashboard.goodMorning") : h < 17 ? t("teacherDashboard.goodAfternoon") : t("teacherDashboard.goodEvening");
}

function todayLabel() {
  // Pinned locale (not `undefined`) to avoid a server/client hydration
  // mismatch — the default locale can differ between server and browser.
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function TeacherDashboardPage() {
  const { t } = useTranslation();
  const [profileName, setProfileName] = useState<string>("");
  const [todaySlots, setTodaySlots] = useState<Slot[]>([]);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [todaySubs, setTodaySubs] = useState<Arrangement[]>([]);
  const [self, setSelf] = useState<SelfAttendance | null>(null);
  // Unrestricted until proven otherwise — matches the base Teacher case
  // (no custom-role assignments => full standard access) so tiles don't
  // flicker hidden while the permissions fetch is in flight.
  const [hasCustomRole, setHasCustomRole] = useState(false);
  const [permissions, setPermissions] = useState<PermissionPair[]>([]);

  useEffect(() => {
    fetch("/api/teacher/permissions").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) {
        setHasCustomRole(!!d.hasCustomRole);
        setPermissions(Array.isArray(d.permissions) ? d.permissions : []);
      }
    }).catch(() => {});
  }, []);

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

  const kpis = [
    {
      label: t("teacherDashboard.todaysClasses"),
      value: todaySlots.length,
      hint: todaySlots.length ? t("teacherDashboard.nextClass", { period: todaySlots[0].period, className: todaySlots[0].className, sectionName: todaySlots[0].sectionName }) : t("teacherDashboard.noClassesScheduled"),
      icon: CalendarDays,
      href: "/teacher/timetable",
    },
    {
      label: t("teacherDashboard.homeworkReviews"),
      value: pendingReviews,
      hint: pendingReviews ? t("teacherDashboard.submissionsAwaitingReview") : t("teacherDashboard.allCaughtUp"),
      icon: BookOpenCheck,
      href: "/teacher/homework",
    },
    {
      label: t("teacherDashboard.substitutions"),
      value: todaySubs.length,
      hint: todaySubs.length ? t("teacherDashboard.inPlaceOf", { name: todaySubs[0].absentTeacher.name }) : t("teacherDashboard.noDutiesToday"),
      icon: RefreshCw,
      href: "/teacher/arrangements",
    },
  ];

  const quickLinks = [
    { label: t("teacherDashboard.earlyLeave"), desc: t("teacherDashboard.earlyLeaveDesc"), icon: DoorOpen, href: "/teacher/early-leave" },
    { label: t("teacherDashboard.reportCards"), desc: t("teacherDashboard.reportCardsDesc"), icon: Award, href: "/teacher/report-cards" },
    { label: t("teacherDashboard.attendance"), desc: t("teacherDashboard.attendanceDesc"), icon: ClipboardCheck, href: "/teacher/attendance" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Hero greeting */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-6 md:p-7"
        style={{ background: "linear-gradient(120deg, hsl(var(--primary) / 0.12), hsl(var(--primary) / 0.03) 60%, transparent)" }}
      >
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{todayLabel()}</p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {greeting(t)}{profileName ? `, ${profileName.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("teacherDashboard.daySnapshot")}</p>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      </div>

      {/* KPI grid + attendance */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((c) => (
          <Link key={c.label} href={c.href} className="group focus-visible:outline-none">
            <Card className="h-full border-border transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <c.icon className="h-5 w-5" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                </div>
                <p className="mt-4 text-3xl font-bold tracking-tight text-foreground">{c.value}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{c.label}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.hint}</p>
              </CardContent>
            </Card>
          </Link>
        ))}

        {/* Attendance Status */}
        <Link href="/teacher/attendance" className="group focus-visible:outline-none">
          <Card className="h-full border-border transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ClipboardCheck className="h-5 w-5" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
              </div>
              <div className="mt-4">
                {selfCfg ? (
                  <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold", selfCfg.color)}>
                    <selfCfg.icon className="h-3.5 w-3.5" /> {t(selfCfg.labelKey)}
                  </span>
                ) : (
                  <span className="text-lg font-semibold italic text-muted-foreground">{t("teacherDashboard.notMarked")}</span>
                )}
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{t("teacherDashboard.myAttendance")}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {self?.cutoffTime ? t("teacherDashboard.cutoffLabel", { time: self.cutoffTime }) : t("teacherDashboard.yourAttendanceToday")}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Two-column: Today's Classes + Quick access */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today's schedule detail */}
        <Card className="border-border lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">{t("teacherDashboard.todaysClasses")}</h2>
                <p className="text-xs text-muted-foreground">{t("teacherDashboard.periodsScheduled", { count: todaySlots.length, plural: todaySlots.length === 1 ? "" : "s" })}</p>
              </div>
              <Link href="/teacher/timetable" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                {t("teacherDashboard.fullTimetable")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {todaySlots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <CalendarDays className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">{t("teacherDashboard.noClassesToday")}</p>
                <p className="text-xs text-muted-foreground">{t("teacherDashboard.enjoyLighterSchedule")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todaySlots.map((s) => (
                  <div key={`${s.dayOfWeek}-${s.period}`} className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/60">
                    <div className="flex h-10 w-10 flex-shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <span className="text-[9px] font-semibold leading-none">PERIOD</span>
                      <span className="text-sm font-bold leading-none">{s.period}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{t("teacherDashboard.classSection", { className: s.className, sectionName: s.sectionName })}</p>
                      {s.subject && <p className="truncate text-xs text-muted-foreground">{s.subject}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick access */}
        <Card className="border-border">
          <CardContent className="p-5">
            <h2 className="mb-4 text-base font-semibold text-foreground">{t("teacherDashboard.quickAccess")}</h2>
            <div className="space-y-2">
              {quickLinks.map((q) => (
                <Link
                  key={q.label}
                  href={q.href}
                  className="group flex items-center gap-3 rounded-xl border border-border p-3 transition-all hover:border-primary/40 hover:bg-primary/5"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <q.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{q.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{q.desc}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All modules — full tile grid, gated per-module for Operational/Delegated Teachers */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground/70">{t("teacherDashboard.allModules")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TEACHER_NAV_ITEMS.filter((item) => item.href !== "/teacher").filter((item) => {
            const gateModule = MODULE_GATE[item.href];
            if (!gateModule || !hasCustomRole) return true;
            return permissions.some((p) => p.module === gateModule && p.action === "VIEW");
          }).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-primary"
                  style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.14), hsl(var(--primary) / 0.05))" }}
                >
                  <item.icon className="h-5 w-5" />
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <span className="text-sm font-semibold leading-tight text-foreground">{t(item.labelKey)}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
