import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { sessionRole } from "@/lib/tenant";
import OperationsCommandCenter from "@/components/operations/OperationsCommandCenter";

export default async function DashboardPage({ params }: { params: Promise<{ schoolSlug: string }> }) {
  const { schoolSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const school = await prisma.school.findUnique({
    where: { slug: schoolSlug },
  });

  if (!school) redirect("/no-school");

  const role = sessionRole(session.user) ?? "";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-2 sm:px-6 lg:px-8">
      {/* Hero Greeting */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border/80 p-6 shadow-sm md:p-8"
        style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.02) 70%, transparent)" }}
      >
        <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">{formatDate(new Date())}</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">Welcome back, {school.name} 👋</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">Manage your classes, teachers, student attendance, fees, and exams.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/dashboard/${schoolSlug}/students`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/95 hover:shadow-lg hover:shadow-primary/30"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Student
            </Link>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* Live Operations Command Center */}
      <div className="space-y-2">
        <h3 className="text-lg font-bold tracking-tight text-gray-900">School Operations Command Center</h3>
        <OperationsCommandCenter 
          schoolId={school.id} 
          userRole={role} 
          schoolSlug={schoolSlug} 
        />
      </div>
    </div>
  );
}
