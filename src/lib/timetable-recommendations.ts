import { prisma } from "@/lib/prisma";

export interface FreeSlot {
  dayOfWeek: number;
  period: number;
}

/**
 * Finds grid cells in a section's timetable that are both empty in that
 * section AND not already occupied by the given teacher in any other
 * section -- i.e. slots where this teacher could actually be assigned.
 */
export async function findFreeSlotsForTeacher(args: {
  schoolId: string;
  sectionId: string;
  teacherId: string;
  periodsPerDay: number;
  daysPerWeek: number;
}): Promise<FreeSlot[]> {
  const { schoolId, sectionId, teacherId, periodsPerDay, daysPerWeek } = args;

  const [sectionSlots, teacherBusyElsewhere] = await Promise.all([
    prisma.timetableSlot.findMany({
      where: { schoolId, sectionId },
      select: { dayOfWeek: true, period: true },
    }),
    prisma.timetableSlot.findMany({
      where: { schoolId, teacherId, NOT: { sectionId } },
      select: { dayOfWeek: true, period: true },
    }),
  ]);

  const occupied = new Set([
    ...sectionSlots.map((s) => `${s.dayOfWeek}-${s.period}`),
    ...teacherBusyElsewhere.map((s) => `${s.dayOfWeek}-${s.period}`),
  ]);

  const free: FreeSlot[] = [];
  for (let day = 1; day <= daysPerWeek; day++) {
    for (let period = 1; period <= periodsPerDay; period++) {
      if (!occupied.has(`${day}-${period}`)) free.push({ dayOfWeek: day, period });
    }
  }
  return free;
}
