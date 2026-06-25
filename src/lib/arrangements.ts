import { prisma } from "@/lib/prisma";

/**
 * Maps JS Date.getDay() (0=Sun,1=Mon..6=Sat) to DB dayOfWeek (1=Mon..6=Sat).
 * Returns null for Sunday since school is closed.
 */
function jsToDbDay(jsDay: number): number | null {
  if (jsDay === 0) return null; // Sunday — no school
  return jsDay; // Mon=1..Sat=6 match directly
}

/** Returns array of dates (local midnight) between fromDate and toDate inclusive. */
function dateRange(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const cur = normalizeDate(from);
  const end = normalizeDate(to);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Strips the time component so the value maps cleanly onto a Postgres DATE column. */
function normalizeDate(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export interface GenerationSummary {
  arrangementsCreated: number;
  substitutesAssigned: number;
  unassigned: number;
}

function emptySummary(): GenerationSummary {
  return { arrangementsCreated: 0, substitutesAssigned: 0, unassigned: 0 };
}

interface AbsenceContext {
  /** Teachers absent the whole day (attendance ABSENT or an approved full-day leave). */
  fullyAbsent: { teacherId: string }[];
  /** Teachers who leave partway through the day via an approved early-leave request. */
  earlyLeaves: { teacherId: string; leaveAfterPeriod: number }[];
  /** Anyone who must never be picked as a substitute on this date. */
  excludeFromCandidates: Set<string>;
}

/**
 * Detects who is unavailable on a given date for one school: teachers marked ABSENT,
 * teachers on an approved full-day leave covering the date, and teachers with an
 * approved early-leave for the date. All are scoped by schoolId for tenant isolation.
 */
async function getAbsenceContext(schoolId: string, date: Date): Promise<AbsenceContext> {
  const [attendance, leaves, earlyLeaves] = await Promise.all([
    prisma.attendance.findMany({
      where: { schoolId, date, type: "TEACHER", status: "ABSENT", teacherId: { not: null } },
      select: { teacherId: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        schoolId,
        type: "TEACHER",
        status: "APPROVED",
        teacherId: { not: null },
        fromDate: { lte: date },
        toDate: { gte: date },
      },
      select: { teacherId: true },
    }),
    prisma.teacherEarlyLeaveRequest.findMany({
      where: { schoolId, status: "APPROVED", date },
      select: { teacherId: true, leaveAfterPeriod: true },
    }),
  ]);

  const fullyAbsentIds = new Set<string>();
  for (const a of attendance) if (a.teacherId) fullyAbsentIds.add(a.teacherId);
  for (const l of leaves) if (l.teacherId) fullyAbsentIds.add(l.teacherId);

  const excludeFromCandidates = new Set<string>(fullyAbsentIds);
  for (const e of earlyLeaves) excludeFromCandidates.add(e.teacherId);

  return {
    fullyAbsent: [...fullyAbsentIds].map((teacherId) => ({ teacherId })),
    // A teacher who is fully absent takes precedence over a partial early-leave entry.
    earlyLeaves: earlyLeaves.filter((e) => !fullyAbsentIds.has(e.teacherId)),
    excludeFromCandidates,
  };
}

interface TeacherDayOptions {
  /** Only cover periods strictly greater than this (used for early-leave). */
  fromPeriodExclusive?: number;
  /** Link generated arrangements to a full-day leave request, when applicable. */
  leaveRequestId?: string | null;
}

/**
 * Core substitution routine for a single absent teacher on a single working day.
 *
 * Algorithm:
 *   1. Read the absent teacher's timetable slots for the weekday (optionally only
 *      periods after an early-leave cutoff).
 *   2. Build per-period "busy" sets from existing timetable assignments and already
 *      created arrangements so nobody is double-booked.
 *   3. For each uncovered slot, choose a substitute from same-school teachers who are
 *      free, are not themselves absent, preferring (a) a same-subject teacher, then
 *      (b) the teacher with the fewest substitutions so far that day.
 *   4. Create the Arrangement (with substituteTeacherId left null if nobody is free).
 *
 * Idempotent: an existing arrangement for (date, absentTeacher, period) is skipped.
 */
async function generateForTeacherDay(
  schoolId: string,
  absentTeacherId: string,
  date: Date,
  dbDay: number,
  excludeFromCandidates: Set<string>,
  opts: TeacherDayOptions = {}
): Promise<GenerationSummary> {
  const summary = emptySummary();

  const slots = await prisma.timetableSlot.findMany({
    where: {
      schoolId,
      teacherId: absentTeacherId,
      dayOfWeek: dbDay,
      ...(opts.fromPeriodExclusive != null ? { period: { gt: opts.fromPeriodExclusive } } : {}),
    },
    select: { period: true, sectionId: true, subject: true },
    orderBy: { period: "asc" },
  });
  if (slots.length === 0) return summary;

  // Candidate substitutes: every other active teacher in the same school who isn't absent.
  const teachers = await prisma.teacher.findMany({
    where: { schoolId, id: { not: absentTeacherId }, isDeleted: false },
    select: { id: true, subject: true },
  });
  const candidates = teachers.filter((t) => !excludeFromCandidates.has(t.id));

  // Teachers occupied by their own timetable, grouped by period.
  const daySlots = await prisma.timetableSlot.findMany({
    where: { schoolId, dayOfWeek: dbDay, teacherId: { not: null } },
    select: { teacherId: true, period: true },
  });
  const timetableBusyByPeriod = new Map<number, Set<string>>();
  for (const s of daySlots) {
    if (!s.teacherId) continue;
    if (!timetableBusyByPeriod.has(s.period)) timetableBusyByPeriod.set(s.period, new Set());
    timetableBusyByPeriod.get(s.period)!.add(s.teacherId);
  }

  // Existing arrangements for the date: drive both per-period busy sets and the
  // running substitution counts used for load balancing.
  const existingArrangements = await prisma.arrangement.findMany({
    where: { schoolId, date, substituteTeacherId: { not: null } },
    select: { substituteTeacherId: true, period: true },
  });
  const arrangementBusyByPeriod = new Map<number, Set<string>>();
  const assignedCount = new Map<string, number>();
  for (const a of existingArrangements) {
    if (!a.substituteTeacherId) continue;
    if (!arrangementBusyByPeriod.has(a.period)) arrangementBusyByPeriod.set(a.period, new Set());
    arrangementBusyByPeriod.get(a.period)!.add(a.substituteTeacherId);
    assignedCount.set(a.substituteTeacherId, (assignedCount.get(a.substituteTeacherId) ?? 0) + 1);
  }

  for (const slot of slots) {
    const existing = await prisma.arrangement.findUnique({
      where: { date_absentTeacherId_period: { date, absentTeacherId, period: slot.period } },
    });
    if (existing) continue;

    const ttBusy = timetableBusyByPeriod.get(slot.period) ?? new Set<string>();
    const arrBusy = arrangementBusyByPeriod.get(slot.period) ?? new Set<string>();
    const free = candidates.filter((c) => !ttBusy.has(c.id) && !arrBusy.has(c.id));

    let substituteId: string | null = null;
    if (free.length > 0) {
      const wantedSubject = slot.subject?.trim().toLowerCase();
      free.sort((a, b) => {
        const aSubject = wantedSubject && a.subject?.trim().toLowerCase() === wantedSubject ? 0 : 1;
        const bSubject = wantedSubject && b.subject?.trim().toLowerCase() === wantedSubject ? 0 : 1;
        if (aSubject !== bSubject) return aSubject - bSubject; // prefer same subject
        const aCount = assignedCount.get(a.id) ?? 0;
        const bCount = assignedCount.get(b.id) ?? 0;
        if (aCount !== bCount) return aCount - bCount; // prefer fewest substitutions
        return a.id.localeCompare(b.id); // stable tiebreaker
      });
      substituteId = free[0].id;
    }

    await prisma.arrangement.create({
      data: {
        date,
        dayOfWeek: dbDay,
        period: slot.period,
        subject: slot.subject,
        sectionId: slot.sectionId,
        absentTeacherId,
        substituteTeacherId: substituteId,
        leaveRequestId: opts.leaveRequestId ?? null,
        schoolId,
      },
    });

    summary.arrangementsCreated++;
    if (substituteId) {
      summary.substitutesAssigned++;
      assignedCount.set(substituteId, (assignedCount.get(substituteId) ?? 0) + 1);
      arrBusy.add(substituteId);
      arrangementBusyByPeriod.set(slot.period, arrBusy);
    } else {
      summary.unassigned++;
    }
  }

  return summary;
}

/**
 * Called when a TEACHER full-day leave request is approved. Creates substitution
 * arrangements for every working day in the leave range.
 */
export async function createArrangementsForLeave(
  leaveRequestId: string,
  absentTeacherId: string,
  schoolId: string,
  fromDate: Date,
  toDate: Date
): Promise<GenerationSummary> {
  const summary = emptySummary();
  for (const date of dateRange(fromDate, toDate)) {
    const dbDay = jsToDbDay(date.getDay());
    if (dbDay === null) continue; // Skip Sundays

    const { excludeFromCandidates } = await getAbsenceContext(schoolId, date);
    excludeFromCandidates.add(absentTeacherId);

    const dayResult = await generateForTeacherDay(
      schoolId,
      absentTeacherId,
      date,
      dbDay,
      excludeFromCandidates,
      { leaveRequestId }
    );
    summary.arrangementsCreated += dayResult.arrangementsCreated;
    summary.substitutesAssigned += dayResult.substitutesAssigned;
    summary.unassigned += dayResult.unassigned;
  }
  return summary;
}

/**
 * Called when an early-leave request is approved. Substitutes only the periods that
 * fall after the teacher leaves.
 */
export async function createArrangementsForEarlyLeave(earlyLeave: {
  schoolId: string;
  teacherId: string;
  date: Date;
  leaveAfterPeriod: number;
}): Promise<GenerationSummary> {
  const date = normalizeDate(earlyLeave.date);
  const dbDay = jsToDbDay(date.getDay());
  if (dbDay === null) return emptySummary();

  const { excludeFromCandidates } = await getAbsenceContext(earlyLeave.schoolId, date);
  excludeFromCandidates.add(earlyLeave.teacherId);

  return generateForTeacherDay(
    earlyLeave.schoolId,
    earlyLeave.teacherId,
    date,
    dbDay,
    excludeFromCandidates,
    { fromPeriodExclusive: earlyLeave.leaveAfterPeriod }
  );
}

export interface AutoGenerateResult extends GenerationSummary {
  dayOff: boolean;
  absentTeachers: number;
}

/**
 * Admin-triggered sweep for a single date: detects every absent / early-leaving teacher
 * in the school and fills the resulting timetable gaps with substitutes.
 */
export async function autoGenerateArrangementsForDate(
  schoolId: string,
  inputDate: Date
): Promise<AutoGenerateResult> {
  const date = normalizeDate(inputDate);
  const dbDay = jsToDbDay(date.getDay());
  if (dbDay === null) {
    return { dayOff: true, absentTeachers: 0, ...emptySummary() };
  }

  const { fullyAbsent, earlyLeaves, excludeFromCandidates } = await getAbsenceContext(schoolId, date);

  const summary = emptySummary();
  for (const { teacherId } of fullyAbsent) {
    const r = await generateForTeacherDay(schoolId, teacherId, date, dbDay, excludeFromCandidates, {});
    summary.arrangementsCreated += r.arrangementsCreated;
    summary.substitutesAssigned += r.substitutesAssigned;
    summary.unassigned += r.unassigned;
  }
  for (const { teacherId, leaveAfterPeriod } of earlyLeaves) {
    const r = await generateForTeacherDay(schoolId, teacherId, date, dbDay, excludeFromCandidates, {
      fromPeriodExclusive: leaveAfterPeriod,
    });
    summary.arrangementsCreated += r.arrangementsCreated;
    summary.substitutesAssigned += r.substitutesAssigned;
    summary.unassigned += r.unassigned;
  }

  return {
    dayOff: false,
    absentTeachers: fullyAbsent.length + earlyLeaves.length,
    ...summary,
  };
}
