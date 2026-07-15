import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import AnnouncementsClient from "./AnnouncementsClient";

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [announcements, summaryRows, classes] = await Promise.all([
    prisma.announcement.findMany({
      where: { schoolId: school.id },
      include: {
        createdBy: { select: { name: true, role: true } },
        audience: true,
        targets: { include: { class: { select: { name: true } }, section: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.announcement.groupBy({ by: ["status"], where: { schoolId: school.id }, _count: { _all: true } }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      select: { id: true, name: true, sections: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const summary: Record<string, number> = { DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0, ARCHIVED: 0, CANCELLED: 0 };
  for (const row of summaryRows) summary[row.status] = row._count._all;

  return (
    <AnnouncementsClient
      initialAnnouncements={JSON.parse(JSON.stringify(announcements))}
      initialSummary={summary}
      classes={JSON.parse(JSON.stringify(classes))}
      schoolId={school.id}
    />
  );
}
