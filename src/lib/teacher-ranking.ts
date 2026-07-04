import { prisma } from "@/lib/prisma";

export interface RankedTeacher {
  id: string;
  name: string;
  subject: string | null;
  periodsPerWeek: number;
}

/**
 * Ranks active teachers in a school as replacement candidates for a subject:
 * same-subject match first, then lowest current weekly period load.
 * Mirrors the comparator already used for daily substitute selection in
 * src/lib/arrangements.ts, extracted here so both call sites share one rule.
 */
export async function rankReplacementTeachers(
  schoolId: string,
  subjectName: string | null | undefined,
  excludeTeacherId?: string
): Promise<RankedTeacher[]> {
  const teachers = await prisma.teacher.findMany({
    where: {
      schoolId,
      isDeleted: false,
      ...(excludeTeacherId ? { id: { not: excludeTeacherId } } : {}),
    },
    select: {
      id: true,
      name: true,
      subject: true,
      timetableSlots: { select: { id: true } },
    },
  });

  const wantedSubject = subjectName?.trim().toLowerCase();

  return teachers
    .map((t) => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      periodsPerWeek: t.timetableSlots.length,
    }))
    .sort((a, b) => {
      const aMatch = wantedSubject && a.subject?.trim().toLowerCase() === wantedSubject ? 0 : 1;
      const bMatch = wantedSubject && b.subject?.trim().toLowerCase() === wantedSubject ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      if (a.periodsPerWeek !== b.periodsPerWeek) return a.periodsPerWeek - b.periodsPerWeek;
      return a.id.localeCompare(b.id);
    });
}
