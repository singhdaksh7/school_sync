import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { serializeApplicationDetail } from "@/lib/admissions/serializers";
import ApplicationDetailClient from "./ApplicationDetailClient";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ schoolSlug: string; applicationId: string }>;
}) {
  const { schoolSlug, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const role = sessionRole(session.user) ?? "";
  if (!["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"].includes(role)) {
    return <div className="p-6 text-sm text-muted-foreground">Admissions is not available for your role.</div>;
  }

  const application = await prisma.admissionApplication.findFirst({
    where: { id: applicationId, schoolId: school.id },
    include: { admissionOffering: { include: { class: true } } },
  });
  if (!application) notFound();

  const [classes, teachers] = await Promise.all([
    prisma.class.findMany({ where: { schoolId: school.id }, include: { sections: true }, orderBy: { name: "asc" } }),
    prisma.teacher.findMany({ where: { schoolId: school.id, isDeleted: false }, select: { id: true, name: true } }),
  ]);

  return (
    <ApplicationDetailClient
      schoolId={school.id}
      applicationId={applicationId}
      canManageEnrollment={role === "SCHOOL_OWNER" || role === "SCHOOL_ADMIN"}
      initial={serializeApplicationDetail(application)}
      requestedClassName={application.admissionOffering.class.name}
      classes={JSON.parse(JSON.stringify(classes))}
      teachers={teachers}
    />
  );
}
