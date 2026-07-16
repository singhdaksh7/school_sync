import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import ApplicationsListClient from "./ApplicationsListClient";

export default async function AdmissionApplicationsPage({ params }: { params: Promise<{ schoolSlug: string }> }) {
  const { schoolSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const role = sessionRole(session.user) ?? "";
  if (!["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"].includes(role)) {
    return <div className="p-6 text-sm text-muted-foreground">Admissions is not available for your role.</div>;
  }

  const cycles = await prisma.admissionCycle.findMany({
    where: { schoolId: school.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, sessionLabel: true, status: true },
  });
  const offerings = await prisma.admissionOffering.findMany({
    where: { admissionCycle: { schoolId: school.id } },
    include: { class: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <ApplicationsListClient
      schoolSlug={schoolSlug}
      schoolId={school.id}
      canCreate={role === "SCHOOL_OWNER" || role === "SCHOOL_ADMIN"}
      cycles={cycles}
      offerings={offerings.map((o) => ({ id: o.id, admissionCycleId: o.admissionCycleId, className: o.class.name }))}
    />
  );
}
