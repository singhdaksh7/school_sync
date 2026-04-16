import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import LeavesClient from "./LeavesClient";

export default async function LeavesPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const leaves = await prisma.leaveRequest.findMany({
    where: { schoolId: school.id, type: "TEACHER" },
    include: {
      teacher: { select: { name: true, subject: true } },
      reviewedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return <LeavesClient initialLeaves={JSON.parse(JSON.stringify(leaves))} schoolId={school.id} />;
}
