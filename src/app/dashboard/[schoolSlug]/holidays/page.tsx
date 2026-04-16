import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import HolidaysClient from "./HolidaysClient";

export default async function HolidaysPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const holidays = await prisma.holiday.findMany({
    where: { schoolId: school.id },
    orderBy: { date: "asc" },
  });

  return <HolidaysClient initialHolidays={JSON.parse(JSON.stringify(holidays))} schoolId={school.id} />;
}
