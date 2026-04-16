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

  const announcements = await prisma.announcement.findMany({
    where: { schoolId: school.id },
    include: { createdBy: { select: { name: true } } },
    orderBy: { publishedAt: "desc" },
  });

  return <AnnouncementsClient initialAnnouncements={JSON.parse(JSON.stringify(announcements))} schoolId={school.id} />;
}
