import Link from "next/link";
import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import {
  Building2, GraduationCap, Users, UserCog, ShieldCheck,
  CheckCircle2, XCircle, Activity, ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function FounderDashboardPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  const [
    totalSchools,
    activeSchools,
    inactiveSchools,
    totalStudents,
    totalTeachers,
    totalParents,
    totalSchoolAdmins,
    recentSchools,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.school.count({ where: { status: "ACTIVE" } }),
    prisma.school.count({ where: { status: "INACTIVE" } }),
    prisma.student.count(),
    prisma.teacher.count(),
    prisma.guardian.count(),
    prisma.user.count({ where: { role: "SCHOOL_ADMIN" } }),
    prisma.school.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        _count: { select: { students: true, teachers: true, guardians: true, admins: true } },
      },
    }),
  ]);

  const statCards = [
    { title: "Total Schools", value: totalSchools, icon: Building2 },
    { title: "Active Schools", value: activeSchools, icon: CheckCircle2 },
    { title: "Inactive Schools", value: inactiveSchools, icon: XCircle },
    { title: "Total Students", value: totalStudents, icon: GraduationCap },
    { title: "Total Teachers", value: totalTeachers, icon: Users },
    { title: "Total Parents", value: totalParents, icon: UserCog },
    { title: "Total School Admins", value: totalSchoolAdmins, icon: ShieldCheck },
  ];

  const avgStudentsPerSchool = totalSchools > 0 ? Math.round(totalStudents / totalSchools) : 0;
  const activeRate = totalSchools > 0 ? Math.round((activeSchools / totalSchools) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-6 md:p-7"
        style={{ background: "linear-gradient(120deg, rgba(99,102,241,0.14), rgba(99,102,241,0.03) 60%, transparent)" }}
      >
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            {formatDate(new Date())}
          </p>
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Welcome back, {session.user?.name ?? "Founder"} 👋
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Here&apos;s how SchoolSync is performing across every school.</p>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-indigo-500/10 blur-2xl" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title} className="border-border transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{stat.value}</p>
                </div>
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent schools */}
        <Card className="border-border lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent Schools</CardTitle>
            <Link href="/founder/schools" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recentSchools.length === 0 ? (
              <EmptyState message="No schools have signed up yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">School</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Students</th>
                      <th className="pb-2 pr-4 font-medium">Teachers</th>
                      <th className="pb-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSchools.map((school) => (
                      <tr key={school.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-foreground">{school.name}</td>
                        <td className="py-2.5 pr-4">
                          <Badge variant={school.status === "ACTIVE" ? "success" : "secondary"}>
                            {school.status === "ACTIVE" ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{school._count.students}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{school._count.teachers}</td>
                        <td className="py-2.5 text-muted-foreground">{formatDate(school.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick statistics */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Quick Statistics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="mb-1 text-sm text-muted-foreground">Active school rate</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{activeRate}%</span>
                <span className="text-sm text-muted-foreground">{activeSchools} of {totalSchools}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${activeRate}%` }} />
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg. students per school</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{avgStudentsPerSchool}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total platform users</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {totalStudents + totalTeachers + totalParents + totalSchoolAdmins}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Latest activity placeholder */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Latest Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState message="Platform-wide activity feed is coming soon." />
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
