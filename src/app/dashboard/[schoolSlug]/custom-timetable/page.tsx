import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import CustomTimetableClient from "./CustomTimetableClient";

export default async function CustomTimetablePage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [classes, teachers] = await Promise.all([
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { schoolId: school.id },
      select: { id: true, name: true, subject: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <CustomTimetableClient
      initialClasses={classes}
      initialTeachers={teachers}
      schoolId={school.id}
      periodsPerDay={school.periodsPerDay}
    />
  );
}
