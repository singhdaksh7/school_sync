import { redirect } from "next/navigation";
import { User, Users, GraduationCap, BadgeCheck, Mail, Phone, Calendar } from "lucide-react";
import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

function Field({ label, value, icon: Icon }: { label: string; value: string; icon: typeof User }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default async function StudentProfilePage() {
  const session = await auth();
  if (!session?.user?.id || sessionRole(session.user) !== "STUDENT") redirect("/student/login");

  const studentId = (session.user as { studentId?: string }).studentId;
  const schoolId = (session.user as { schoolId?: string }).schoolId;
  if (!studentId || !schoolId) redirect("/student/login");

  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    select: {
      id: true,
      name: true,
      rollNo: true,
      admissionNo: true,
      email: true,
      phone: true,
      parentName: true,
      parentPhone: true,
      createdAt: true,
      section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
      school: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
  });
  if (!student) redirect("/student/login");

  const initials = student.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your personal and academic information.</p>
      </div>

      <Card className="overflow-hidden border-border">
        <div
          className="h-20"
          style={{ background: "linear-gradient(120deg, #0ea5e9, #6366f1)" }}
        />
        <CardContent className="relative -mt-10 pb-6">
          <div className="flex flex-col items-center text-center sm:flex-row sm:items-end sm:gap-4 sm:text-left">
            <span className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl border-4 border-card bg-primary text-xl font-bold text-primary-foreground shadow-md">
              {initials}
            </span>
            <div className="mt-3 sm:mt-0">
              <p className="text-lg font-bold text-foreground">{student.name}</p>
              <p className="text-sm text-muted-foreground">
                {student.section.class.name} - {student.section.name} &middot; Roll No. {student.rollNo}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary" /> Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Full Name" value={student.name} icon={User} />
          <Field label="Email" value={student.email || "—"} icon={Mail} />
          <Field label="Phone" value={student.phone || "—"} icon={Phone} />
          <Field label="Joined" value={formatDate(student.createdAt)} icon={Calendar} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" /> Parent / Guardian Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Parent Name" value={student.parentName || "—"} icon={Users} />
          <Field label="Parent Phone" value={student.parentPhone || "—"} icon={Phone} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4 w-4 text-primary" /> Class Details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Class" value={student.section.class.name} icon={GraduationCap} />
          <Field label="Section" value={student.section.name} icon={GraduationCap} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BadgeCheck className="h-4 w-4 text-primary" /> Admission Details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Admission Number" value={student.admissionNo || "—"} icon={BadgeCheck} />
          <Field label="Roll Number" value={student.rollNo} icon={BadgeCheck} />
          <Field label="School" value={student.school.name} icon={GraduationCap} />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Need to update your details? Contact your school administration — students cannot edit critical school records.
      </p>
    </div>
  );
}
