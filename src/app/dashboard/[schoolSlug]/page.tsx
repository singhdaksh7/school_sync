import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Users, GraduationCap, BookOpen, ClipboardCheck, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage({ params }: { params: Promise<{ schoolSlug: string }> }) {
  const { schoolSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const school = await prisma.school.findUnique({
    where: { slug: schoolSlug },
    include: {
      _count: { select: { teachers: true, students: true, classes: true } },
    },
  });

  if (!school) redirect("/onboarding");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayStudentPresent, todayTeacherPresent, totalStudents, totalTeachers] = await Promise.all([
    prisma.attendance.count({
      where: { schoolId: school.id, type: "STUDENT", date: today, status: "PRESENT" },
    }),
    prisma.attendance.count({
      where: { schoolId: school.id, type: "TEACHER", date: today, status: "PRESENT" },
    }),
    prisma.student.count({ where: { schoolId: school.id } }),
    prisma.teacher.count({ where: { schoolId: school.id } }),
  ]);

  const studentAttendancePct = totalStudents > 0
    ? Math.round((todayStudentPresent / totalStudents) * 100)
    : null;

  const stats = [
    { title: "Total Teachers", value: totalTeachers, icon: Users },
    { title: "Total Students", value: totalStudents, icon: GraduationCap },
    { title: "Classes", value: school._count.classes, icon: BookOpen },
    {
      title: "Student Attendance Today",
      value: studentAttendancePct !== null ? `${studentAttendancePct}%` : "—",
      icon: ClipboardCheck,
      sub: studentAttendancePct !== null ? `${todayStudentPresent} of ${totalStudents} present` : "Not marked yet",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero greeting */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-6 md:p-7"
        style={{ background: "linear-gradient(120deg, hsl(var(--primary) / 0.12), hsl(var(--primary) / 0.03) 60%, transparent)" }}
      >
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{formatDate(new Date())}</p>
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground md:text-3xl">Welcome back to {school.name} 👋</h2>
          <p className="mt-1 text-sm text-muted-foreground">Here&apos;s how your school is doing today.</p>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="border-border transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{stat.value}</p>
                  {stat.sub && <p className="mt-1 truncate text-xs text-muted-foreground">{stat.sub}</p>}
                </div>
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Teacher attendance today */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" />
            Today&apos;s Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-sm text-muted-foreground">Teacher Attendance</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{todayTeacherPresent}</span>
                <span className="text-sm text-muted-foreground">of {totalTeachers} present</span>
              </div>
              {totalTeachers > 0 && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round((todayTeacherPresent / totalTeachers) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            <div>
              <p className="mb-1 text-sm text-muted-foreground">Student Attendance</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{todayStudentPresent}</span>
                <span className="text-sm text-muted-foreground">of {totalStudents} present</span>
              </div>
              {totalStudents > 0 && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round((todayStudentPresent / totalStudents) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { href: `/dashboard/${schoolSlug}/teachers`, label: "Add Teacher", icon: Users },
              { href: `/dashboard/${schoolSlug}/students`, label: "Add Student", icon: GraduationCap },
              { href: `/dashboard/${schoolSlug}/classes`, label: "Add Class", icon: BookOpen },
              { href: `/dashboard/${schoolSlug}/attendance`, label: "Mark Attendance", icon: ClipboardCheck },
            ].map((a) => (
              <a
                key={a.href}
                href={a.href}
                className="group flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-all hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors">
                  <a.icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-foreground">{a.label}</span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
