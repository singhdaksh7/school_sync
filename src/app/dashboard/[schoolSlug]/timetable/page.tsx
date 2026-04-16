import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import TimetableClient from "./TimetableClient";

export default async function TimetablePage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [classes, teachers, allSlots] = await Promise.all([
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
    prisma.timetableSlot.findMany({
      where: { schoolId: school.id },
      select: { teacherId: true, dayOfWeek: true, period: true },
    }),
  ]);

  const busySlots = allSlots.filter((s) => s.teacherId !== null) as {
    teacherId: string; dayOfWeek: number; period: number;
  }[];

  return (
    <TimetableClient
      initialClasses={classes}
      initialTeachers={teachers}
      initialBusySlots={busySlots}
      schoolId={school.id}
    />
  );
}
