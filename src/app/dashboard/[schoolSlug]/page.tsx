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
    { title: "Total Teachers", value: totalTeachers, icon: Users, color: "bg-purple-100 text-purple-600" },
    { title: "Total Students", value: totalStudents, icon: GraduationCap, color: "bg-green-100 text-green-600" },
    { title: "Classes", value: school._count.classes, icon: BookOpen, color: "bg-blue-100 text-blue-600" },
    {
      title: "Student Attendance Today",
      value: studentAttendancePct !== null ? `${studentAttendancePct}%` : "—",
      icon: ClipboardCheck,
      color: "bg-orange-100 text-orange-600",
      sub: studentAttendancePct !== null ? `${todayStudentPresent} of ${totalStudents} present` : "Not marked yet",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-500 text-sm mt-1">{formatDate(new Date())} — Welcome back</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500 font-medium">{stat.title}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
                  {stat.sub && <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>}
                </div>
                <div className={`w-10 h-10 rounded-lg ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Teacher attendance today */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            Today&apos;s Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-500 mb-1">Teacher Attendance</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">{todayTeacherPresent}</span>
                <span className="text-sm text-gray-400">of {totalTeachers} present</span>
              </div>
              {totalTeachers > 0 && (
                <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${Math.round((todayTeacherPresent / totalTeachers) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            <div>
              <p className="text-sm text-gray-500 mb-1">Student Attendance</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">{todayStudentPresent}</span>
                <span className="text-sm text-gray-400">of {totalStudents} present</span>
              </div>
              {totalStudents > 0 && (
                <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${Math.round((todayStudentPresent / totalStudents) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { href: `/dashboard/${schoolSlug}/teachers`, label: "Add Teacher", icon: Users, color: "hover:bg-purple-50 hover:border-purple-200" },
              { href: `/dashboard/${schoolSlug}/students`, label: "Add Student", icon: GraduationCap, color: "hover:bg-green-50 hover:border-green-200" },
              { href: `/dashboard/${schoolSlug}/classes`, label: "Add Class", icon: BookOpen, color: "hover:bg-blue-50 hover:border-blue-200" },
              { href: `/dashboard/${schoolSlug}/attendance`, label: "Mark Attendance", icon: ClipboardCheck, color: "hover:bg-orange-50 hover:border-orange-200" },
            ].map((a) => (
              <a
                key={a.href}
                href={a.href}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 text-center transition-colors ${a.color}`}
              >
                <a.icon className="w-5 h-5 text-gray-600" />
                <span className="text-xs font-medium text-gray-700">{a.label}</span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
