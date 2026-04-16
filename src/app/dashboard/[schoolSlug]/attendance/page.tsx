import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import AttendanceClient from "./AttendanceClient";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [classes, teachers, todayAttendance] = await Promise.all([
    prisma.class.findMany({
      where: { schoolId: school.id },
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { schoolId: school.id },
      select: { id: true, name: true, subject: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({
      where: { schoolId: school.id, type: "STUDENT", date: today },
      select: { studentId: true, status: true },
    }),
  ]);

  const sections = classes.flatMap((c) =>
    c.sections.map((s) => ({ id: s.id, name: s.name, class: { name: c.name } }))
  );

  const initialAttendance: Record<string, string> = {};
  todayAttendance.forEach((a) => {
    if (a.studentId) initialAttendance[a.studentId] = a.status;
  });

  return (
    <AttendanceClient
      initialSections={sections}
      initialTeachers={teachers}
      initialAttendance={initialAttendance}
      schoolId={school.id}
    />
  );
}
