import { prisma } from "@/lib/prisma";

/**
 * Maps JS Date.getDay() (0=Sun,1=Mon..6=Sat) to DB dayOfWeek (1=Mon..6=Sat).
 * Returns null for Sunday since school is closed.
 */
function jsToDbDay(jsDay: number): number | null {
  if (jsDay === 0) return null; // Sunday — no school
  return jsDay; // Mon=1..Sat=6 match directly
}

/** Returns array of dates between fromDate and toDate inclusive. */
function dateRange(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/**
 * Called when a TEACHER leave request is approved.
 * For every working day in the leave range:
 *   - Gets absent teacher's timetable slots for that day
 *   - For each slot, finds the first teacher who is free (no timetable + no arrangement)
 *   - Creates an Arrangement record
 */
export async function createArrangementsForLeave(
  leaveRequestId: string,
  absentTeacherId: string,
  schoolId: string,
  fromDate: Date,
  toDate: Date
): Promise<void> {
  const dates = dateRange(fromDate, toDate);

  for (const date of dates) {
    const dbDay = jsToDbDay(date.getDay());
    if (dbDay === null) continue; // Skip Sundays

    // Get absent teacher's slots for this weekday
    const absentSlots = await prisma.timetableSlot.findMany({
      where: { teacherId: absentTeacherId, dayOfWeek: dbDay },
      select: { period: true, sectionId: true, subject: true },
    });

    if (absentSlots.length === 0) continue;

    // Get all teachers in the school (excluding the absent one)
    const allTeachers = await prisma.teacher.findMany({
      where: { schoolId, id: { not: absentTeacherId } },
      select: { id: true },
    });

    for (const slot of absentSlots) {
      // Skip if arrangement already exists for this absent teacher / date / period
      const existing = await prisma.arrangement.findUnique({
        where: { date_absentTeacherId_period: { date, absentTeacherId, period: slot.period } },
      });
      if (existing) continue;

      // Find teachers busy at this period on this weekday (by timetable)
      const timetableBusy = await prisma.timetableSlot.findMany({
        where: { schoolId, dayOfWeek: dbDay, period: slot.period, teacherId: { not: null } },
        select: { teacherId: true },
      });
      const timetableBusyIds = new Set(timetableBusy.map((s) => s.teacherId!));

      // Find teachers already assigned an arrangement at this period on this date
      const arrangementBusy = await prisma.arrangement.findMany({
        where: { schoolId, date, period: slot.period, substituteTeacherId: { not: null } },
        select: { substituteTeacherId: true },
      });
      const arrangementBusyIds = new Set(arrangementBusy.map((a) => a.substituteTeacherId!));

      // Pick first free teacher
      const substitute = allTeachers.find(
        (t) => !timetableBusyIds.has(t.id) && !arrangementBusyIds.has(t.id)
      );

      await prisma.arrangement.create({
        data: {
          date,
          dayOfWeek: dbDay,
          period: slot.period,
          subject: slot.subject,
          sectionId: slot.sectionId,
          absentTeacherId,
          substituteTeacherId: substitute?.id ?? null,
          leaveRequestId,
          schoolId,
        },
      });
    }
  }
}
