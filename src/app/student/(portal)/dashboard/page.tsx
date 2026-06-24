import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BookOpenCheck, ClipboardCheck, Award, ClipboardList, CalendarDays,
  Megaphone, TrendingUp, GraduationCap, PartyPopper,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/tenant";
import { getStudentDashboardData } from "@/lib/student-dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function StudentDashboardPage() {
  const session = await auth();
  if (!session?.user?.id || sessionRole(session.user) !== "STUDENT") redirect("/student/login");

  const studentId = (session.user as { studentId?: string }).studentId;
  const schoolId = (session.user as { schoolId?: string }).schoolId;
  if (!studentId || !schoolId) redirect("/student/login");

  const data = await getStudentDashboardData(studentId, schoolId);
  if (!data) redirect("/student/login");

  const { t } = await getServerTranslation();
  const { profile, attendanceSummary, homeworkSummary, latestResults, announcements, upcomingEvents } = data;
  const { last30Days, currentMonth } = attendanceSummary;
  const latestResult = latestResults.latestExamResults[0];
  const latestReportCard = latestResults.latestReportCard;

  const quickActions = [
    { href: "/student/homework", label: t("studentDashboard.viewHomework"), icon: BookOpenCheck },
    { href: "/student/attendance", label: t("studentDashboard.viewAttendance"), icon: ClipboardCheck },
    { href: "/student/results", label: t("studentDashboard.viewResults"), icon: Award },
    { href: "/student/leave", label: t("studentDashboard.applyLeave"), icon: ClipboardList },
    { href: "/student/timetable", label: t("studentDashboard.viewTimetable"), icon: CalendarDays },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-6 md:p-7"
        style={{ background: "linear-gradient(120deg, rgba(14,165,233,0.14), rgba(99,102,241,0.05) 60%, transparent)" }}
      >
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{formatDate(new Date())}</p>
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {t("studentDashboard.welcomeBack", { name: profile.name.split(" ")[0] })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("studentDashboard.classSection", { className: profile.section.class.name, sectionName: profile.section.name, rollNo: profile.rollNo })}
          </p>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            title: t("studentDashboard.attendance30d"),
            value: `${last30Days.percentage}%`,
            sub: t("studentDashboard.daysPresent", { count: last30Days.present + last30Days.late, total: last30Days.total }),
            icon: ClipboardCheck,
          },
          {
            title: t("studentDashboard.homeworkToday"),
            value: homeworkSummary.todayCount,
            sub: t("studentDashboard.inLast7Days", { count: homeworkSummary.last7DaysCount }),
            icon: BookOpenCheck,
          },
          {
            title: t("studentDashboard.latestResult"),
            value: latestResult ? `${latestResult.marks}/${latestResult.maxMarks}` : "—",
            sub: latestResult ? t("studentDashboard.examGrade", { exam: latestResult.exam.name, grade: latestResult.grade }) : t("studentDashboard.noResultsYet"),
            icon: Award,
          },
          {
            title: t("studentDashboard.reportCard"),
            value: latestReportCard ? `${latestReportCard.percentage.toFixed(1)}%` : "—",
            sub: latestReportCard ? t("studentDashboard.gradeLabel", { grade: latestReportCard.grade }) : t("studentDashboard.notPublishedYet"),
            icon: GraduationCap,
          },
        ].map((stat) => (
          <Card key={stat.title} className="border-border transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{stat.value}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{stat.sub}</p>
                </div>
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Attendance overview */}
        <Card className="border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t("studentDashboard.attendanceOverview")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-sm text-muted-foreground">{t("studentAttendance.thisMonth")}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{currentMonth.percentage}%</span>
                  <span className="text-sm text-muted-foreground">
                    {t("studentDashboard.daysOf", { count: currentMonth.present + currentMonth.late, total: currentMonth.total })}
                  </span>
                </div>
                {currentMonth.total > 0 && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${currentMonth.percentage}%` }} />
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1 text-sm text-muted-foreground">{t("studentDashboard.last30Days")}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{last30Days.percentage}%</span>
                  <span className="text-sm text-muted-foreground">
                    {t("studentDashboard.daysOf", { count: last30Days.present + last30Days.late, total: last30Days.total })}
                  </span>
                </div>
                {last30Days.total > 0 && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${last30Days.percentage}%` }} />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-4 border-t border-border pt-4 text-xs">
              <span className="text-muted-foreground">{t("studentDashboard.presentColon")} <span className="font-semibold text-foreground">{last30Days.present}</span></span>
              <span className="text-muted-foreground">{t("studentDashboard.absentColon")} <span className="font-semibold text-foreground">{last30Days.absent}</span></span>
              <span className="text-muted-foreground">{t("studentDashboard.lateColon")} <span className="font-semibold text-foreground">{last30Days.late}</span></span>
            </div>
          </CardContent>
        </Card>

        {/* Upcoming events */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PartyPopper className="h-4 w-4 text-primary" />
              {t("studentDashboard.upcomingEvents")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("studentDashboard.noUpcomingEvents")}</p>
            ) : (
              <ol className="space-y-4 border-l border-border pl-4">
                {upcomingEvents.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                    <p className="text-sm font-medium text-foreground">{event.title}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(event.date)} &middot; {t("studentDashboard.holiday")}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Homework summary */}
        <Card className="border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenCheck className="h-4 w-4 text-primary" />
              {t("studentDashboard.todaysHomework")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {homeworkSummary.today.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("studentDashboard.noHomeworkToday")}</p>
            ) : (
              <div className="space-y-3">
                {homeworkSummary.today.map((hw) => (
                  <div key={hw.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{hw.title}</p>
                      <p className="text-xs text-muted-foreground">{hw.subject} &middot; {hw.teacher.name}</p>
                    </div>
                    <Badge variant="outline" className="flex-shrink-0">{t("studentDashboard.dueToday")}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Announcements */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary" />
              {t("studentDashboard.announcements")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("studentDashboard.noAnnouncementsYet")}</p>
            ) : (
              <div className="space-y-3">
                {announcements.slice(0, 4).map((a) => (
                  <div key={a.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-foreground">{a.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(a.publishedAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">{t("studentDashboard.quickActions")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="group flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-all hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors">
                  <a.icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-foreground">{a.label}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
