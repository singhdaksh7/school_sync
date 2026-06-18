import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { ArrowLeft, Users, GraduationCap, UserCog, ShieldCheck, Mail, Phone, CreditCard, Flag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import SchoolStatusControl from "./SchoolStatusControl";
import SubscriptionEditor from "./SubscriptionEditor";

const ROLE_LABELS: Record<string, string> = {
  SCHOOL_OWNER: "Owner",
  SCHOOL_ADMIN: "Admin",
  VICE_PRINCIPAL: "Vice Principal",
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  SCHOOL_OWNER: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400",
  SCHOOL_ADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
  VICE_PRINCIPAL: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
};

export default async function FounderSchoolDetailPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  const { schoolId } = await params;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      admins: { select: { id: true, name: true, email: true, role: true } },
      subscription: { include: { plan: true } },
    },
  });

  if (!school) notFound();

  const [teachers, students, parentCount] = await Promise.all([
    prisma.teacher.findMany({
      where: { schoolId },
      include: { mentorSection: { include: { class: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.student.findMany({
      where: { schoolId },
      include: { section: { include: { class: true } } },
      orderBy: [
        { section: { class: { name: "asc" } } },
        { section: { name: "asc" } },
        { rollNo: "asc" },
      ],
    }),
    prisma.guardian.count({ where: { schoolId } }),
  ]);

  const adminRows = [
    { id: school.owner.id, name: school.owner.name, email: school.owner.email, role: "SCHOOL_OWNER" as const },
    ...school.admins.map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role })),
  ];

  const statCards = [
    { title: "Students", value: students.length, icon: GraduationCap },
    { title: "Teachers", value: teachers.length, icon: Users },
    { title: "Parents", value: parentCount, icon: UserCog },
    { title: "Admins", value: adminRows.length, icon: ShieldCheck },
  ];

  const studentRows = students.map((student, i) => {
    const group = `${student.section.class.name} - ${student.section.name}`;
    const prev = students[i - 1];
    const prevGroup = prev ? `${prev.section.class.name} - ${prev.section.name}` : null;
    return { student, group, showHeader: group !== prevGroup };
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link
        href="/founder/schools"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Schools
      </Link>

      {/* School header */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-6 md:p-7"
        style={{ background: "linear-gradient(120deg, rgba(99,102,241,0.14), rgba(99,102,241,0.03) 60%, transparent)" }}
      >
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">{school.name}</h2>
              <SchoolStatusControl schoolId={school.id} status={school.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              /{school.slug} &middot; Created {formatDate(school.createdAt)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-xl border border-border bg-card/80 px-4 py-3 text-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner</p>
              <p className="mt-0.5 font-medium text-foreground">{school.owner.name}</p>
              <p className="text-xs text-muted-foreground">{school.owner.email}</p>
            </div>
            <Button variant="outline" size="sm" asChild className="gap-1.5">
              <Link href={`/founder/schools/${school.id}/feature-flags`}>
                <Flag className="h-3.5 w-3.5" /> Feature Flags
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title} className="border-border">
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

      {/* Subscription */}
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Subscription
          </CardTitle>
          <SubscriptionEditor
            schoolId={school.id}
            current={
              school.subscription
                ? {
                    planId: school.subscription.planId,
                    billingCycle: school.subscription.billingCycle,
                    amount: school.subscription.amount.toString(),
                    currentPeriodEnd: school.subscription.currentPeriodEnd?.toISOString() ?? null,
                  }
                : null
            }
          />
        </CardHeader>
        <CardContent>
          {school.subscription ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan</p>
                <p className="mt-1 text-lg font-bold text-foreground">{school.subscription.plan.name}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Billing Cycle</p>
                <p className="mt-1 text-lg font-bold text-foreground">
                  {school.subscription.billingCycle === "ANNUAL" ? "Annual" : "Monthly"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</p>
                <p className="mt-1 text-lg font-bold text-foreground">{formatCurrency(school.subscription.amount.toString())}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Started</p>
                <p className="mt-1 text-lg font-bold text-foreground">{formatDate(school.subscription.startedAt)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Renewal Date</p>
                <p className="mt-1 text-lg font-bold text-foreground">
                  {school.subscription.currentPeriodEnd ? formatDate(school.subscription.currentPeriodEnd) : "—"}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState message="No subscription assigned to this school yet." />
          )}
        </CardContent>
      </Card>

      {/* Admins & Owner */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Admins &amp; Owner ({adminRows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {adminRows.length === 0 ? (
            <EmptyState message="No admins on this school." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Email</th>
                    <th className="pb-2 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {adminRows.map((admin) => (
                    <tr key={admin.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{admin.name}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{admin.email}</td>
                      <td className="py-2.5">
                        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", ROLE_BADGE_CLASS[admin.role] ?? "bg-muted text-muted-foreground")}>
                          {ROLE_LABELS[admin.role] ?? admin.role}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teachers */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Teachers ({teachers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 ? (
            <EmptyState message="No teachers in this school yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Subject</th>
                    <th className="pb-2 pr-4 font-medium">Contact</th>
                    <th className="pb-2 font-medium">Mentor Section</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((teacher) => (
                    <tr key={teacher.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{teacher.name}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{teacher.subject || "—"}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        <div className="flex flex-col gap-0.5">
                          {teacher.email && (
                            <span className="flex items-center gap-1.5">
                              <Mail className="h-3 w-3" /> {teacher.email}
                            </span>
                          )}
                          {teacher.phone && (
                            <span className="flex items-center gap-1.5">
                              <Phone className="h-3 w-3" /> {teacher.phone}
                            </span>
                          )}
                          {!teacher.email && !teacher.phone && "—"}
                        </div>
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {teacher.mentorSection ? `${teacher.mentorSection.class.name} - ${teacher.mentorSection.name}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students, grouped by Class -> Section */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Students ({students.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <EmptyState message="No students enrolled in this school yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Roll No</th>
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 font-medium">Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {studentRows.map(({ student, group, showHeader }) => (
                    <FragmentRow key={student.id} showHeader={showHeader} group={group} student={student} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type StudentRow = {
  id: string;
  rollNo: string;
  name: string;
  email: string | null;
  phone: string | null;
};

function FragmentRow({ showHeader, group, student }: { showHeader: boolean; group: string; student: StudentRow }) {
  return (
    <>
      {showHeader && (
        <tr className="bg-muted/40">
          <td colSpan={3} className="px-1 py-2 text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            {group}
          </td>
        </tr>
      )}
      <tr className="border-b border-border/60 last:border-0">
        <td className="py-2.5 pr-4 text-muted-foreground">{student.rollNo}</td>
        <td className="py-2.5 pr-4 font-medium text-foreground">{student.name}</td>
        <td className="py-2.5 text-muted-foreground">
          {student.email || student.phone || "—"}
        </td>
      </tr>
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
