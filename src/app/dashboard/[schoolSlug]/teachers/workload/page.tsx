import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import WorkloadClient from "./WorkloadClient";

export default async function TeacherWorkloadPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const teachers = await prisma.teacher.findMany({
    where: { schoolId: school.id },
    include: {
      timetableSlots: {
        include: { section: { include: { class: { select: { name: true } } } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const workload = teachers.map((t) => {
    const slots = t.timetableSlots;
    const periodsPerWeek = slots.length;
    const sectionSet = new Map<string, string>();
    for (const s of slots) {
      if (!sectionSet.has(s.sectionId))
        sectionSet.set(s.sectionId, `${s.section.class.name}-${s.section.name}`);
    }
    const subjects = [...new Set(slots.map((s) => s.subject).filter(Boolean))] as string[];
    const perDay: Record<number, number> = {};
    for (const s of slots) perDay[s.dayOfWeek] = (perDay[s.dayOfWeek] || 0) + 1;
    let busiestDay = 0, busiestCount = 0;
    for (const [day, count] of Object.entries(perDay)) {
      if (count > busiestCount) { busiestCount = count; busiestDay = Number(day); }
    }
    return {
      id: t.id, name: t.name, email: t.email, subject: t.subject,
      periodsPerWeek, sections: Array.from(sectionSet.values()),
      subjects, perDay, busiestDay, busiestCount,
      isMentor: !!t.mentorSectionId,
    };
  });

  return <WorkloadClient initialWorkload={workload} />;
}
