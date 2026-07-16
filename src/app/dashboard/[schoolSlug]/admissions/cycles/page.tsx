import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { serializeCycle } from "@/lib/admissions/serializers";
import CyclesClient from "./CyclesClient";

export default async function AdmissionCyclesPage({ params }: { params: Promise<{ schoolSlug: string }> }) {
  const { schoolSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const role = sessionRole(session.user) ?? "";
  if (role !== "SCHOOL_OWNER" && role !== "SCHOOL_ADMIN") {
    return <div className="p-6 text-sm text-muted-foreground">Cycle configuration is limited to school owners and admins.</div>;
  }

  const [cycles, classes] = await Promise.all([
    prisma.admissionCycle.findMany({ where: { schoolId: school.id }, orderBy: { createdAt: "desc" } }),
    prisma.class.findMany({ where: { schoolId: school.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return <CyclesClient schoolId={school.id} initialCycles={cycles.map(serializeCycle)} classes={classes} />;
}
