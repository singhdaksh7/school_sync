import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import AuditLogsClient from "./AuditLogsClient";

export default async function AuditLogsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const logs = await prisma.auditLog.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return <AuditLogsClient initialLogs={JSON.parse(JSON.stringify(logs))} schoolId={school.id} />;
}
