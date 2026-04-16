import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const schoolData = await prisma.school.findUnique({
    where: { id: school.id },
    include: { admins: { select: { id: true, name: true, email: true } } },
  });

  if (!schoolData) return null;

  return <SettingsClient initialSchool={schoolData} />;
}
