/**
 * School Operations Command Center — batched TODAY OPERATIONS CONTEXT loader
 * (PART 4). Every engine that needs "today's" teacher roster, attendance,
 * leave, timetable, or arrangement state shares ONE load instead of
 * independently re-querying the same rows — teacher-status, lecture-coverage,
 * and teacher-workload all consume this same context.
 *
 * Deliberately bounded: teacher/timetable/leave/arrangement rows for one
 * school-day are at most a few hundred rows even at pilot scale (100
 * teachers × 6 periods = 600 slots) — small enough to hold in memory and
 * cheap enough to load in one batch, unlike student attendance (2,000+ rows),
 * which stays as a dedicated DB aggregate query in operations-attendance.ts
 * rather than being hydrated into this context.
 */

import { prisma } from "@/lib/prisma";
import { resolveSchoolLocalNow, schoolDbDayOfWeek, schoolLocalDateOnly, resolveCurrentPeriod, DEFAULT_SCHOOL_TIMEZONE, type CurrentPeriodResolution, type SchoolPeriodRow } from "@/lib/school-time";
import type { SchoolWorkloadDefaults, TeacherWorkloadOverrideFields } from "@/lib/teacher-workload-rules";

export interface TeacherRosterRow {
  id: string;
  name: string;
  subject: string | null;
}

export interface TimetableSlotRow {
  id: string;
  sectionId: string;
  sectionName: string;
  className: string;
  period: number;
  teacherId: string | null;
  subject: string | null;
}

export interface ArrangementRow {
  id: string;
  sectionId: string;
  period: number;
  subject: string | null;
  absentTeacherId: string;
  substituteTeacherId: string | null;
}

export interface TodayOperationsContext {
  schoolId: string;
  dateKey: string;
  timeOfDay: string;
  dbDay: number | null;
  dateOnly: Date;
  timetableWorkingDays: number;
  periodsPerDay: number;
  workloadDefaults: SchoolWorkloadDefaults;
  /** teacherId -> that teacher's TeacherWorkloadOverride row, if any (see teacher-workload-rules.ts). */
  teacherWorkloadOverrides: Map<string, TeacherWorkloadOverrideFields>;
  periodSchedule: SchoolPeriodRow[];
  periodState: CurrentPeriodResolution;
  teachers: Map<string, TeacherRosterRow>;
  /** teacherId -> Attendance status today ("PRESENT"|"ABSENT"|"LATE"), absent if no row. */
  teacherAttendance: Map<string, "PRESENT" | "ABSENT" | "LATE">;
  /** teacherIds on an approved full-day leave covering today. */
  teachersOnLeave: Set<string>;
  /** teacherId -> leaveAfterPeriod for an approved early leave today. */
  teacherEarlyLeave: Map<string, number>;
  /** Today's dbDay's timetable slots for the whole school. */
  todaySlots: TimetableSlotRow[];
  /** Today's arrangements for the whole school. */
  todayArrangements: ArrangementRow[];
  sections: { id: string; name: string; classId: string; className: string }[];
}

/** Lightweight helper for routes that only need today's school-local dateOnly (not the full batched context). */
export async function resolveSchoolTodayDateOnly(schoolId: string, now: Date = new Date()): Promise<Date> {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  const { dateKey } = resolveSchoolLocalNow(school.timezone || DEFAULT_SCHOOL_TIMEZONE, now);
  return schoolLocalDateOnly(dateKey);
}

export async function loadTodayOperationsContext(schoolId: string, now: Date = new Date()): Promise<TodayOperationsContext> {
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: {
      timezone: true,
      timetableWorkingDays: true,
      periodsPerDay: true,
      defaultMaxWeeklyTeachingPeriods: true,
      defaultMinFreeTeachingPeriods: true,
      defaultMaxDailyTeachingPeriods: true,
      defaultMaxConsecutiveTeachingPeriods: true,
    },
  });
  const timezone = school.timezone || DEFAULT_SCHOOL_TIMEZONE;
  const { dateKey, timeOfDay, jsWeekday } = resolveSchoolLocalNow(timezone, now);
  const dbDay = schoolDbDayOfWeek(jsWeekday);
  const dateOnly = schoolLocalDateOnly(dateKey);

  const [periodScheduleRows, teachers, teacherAttendanceRows, fullDayLeaves, earlyLeaves, slotsRaw, arrangementsRaw, sections, workloadOverrideRows] = await Promise.all([
    prisma.schoolPeriodSchedule.findMany({ where: { schoolId }, orderBy: { periodNumber: "asc" } }),
    prisma.teacher.findMany({ where: { schoolId, isDeleted: false }, select: { id: true, name: true, subject: true }, orderBy: { id: "asc" } }),
    prisma.attendance.findMany({
      where: { schoolId, type: "TEACHER", date: dateOnly },
      select: { teacherId: true, status: true },
    }),
    dbDay !== null
      ? prisma.leaveRequest.findMany({
          where: { schoolId, type: "TEACHER", status: "APPROVED", teacherId: { not: null }, fromDate: { lte: dateOnly }, toDate: { gte: dateOnly } },
          select: { teacherId: true },
        })
      : Promise.resolve([]),
    dbDay !== null
      ? prisma.teacherEarlyLeaveRequest.findMany({ where: { schoolId, status: "APPROVED", date: dateOnly }, select: { teacherId: true, leaveAfterPeriod: true } })
      : Promise.resolve([]),
    dbDay !== null
      ? prisma.timetableSlot.findMany({
          where: { schoolId, dayOfWeek: dbDay },
          select: { id: true, sectionId: true, period: true, teacherId: true, subject: true, section: { select: { name: true, class: { select: { name: true } } } } },
          orderBy: [{ sectionId: "asc" }, { period: "asc" }],
        })
      : Promise.resolve([]),
    dbDay !== null
      ? prisma.arrangement.findMany({
          where: { schoolId, date: dateOnly },
          select: { id: true, sectionId: true, period: true, subject: true, absentTeacherId: true, substituteTeacherId: true },
        })
      : Promise.resolve([]),
    prisma.section.findMany({ where: { class: { schoolId } }, select: { id: true, name: true, classId: true, class: { select: { name: true } } }, orderBy: { id: "asc" } }),
    prisma.teacherWorkloadOverride.findMany({
      where: { schoolId },
      select: { teacherId: true, maxWeeklyTeachingPeriods: true, minFreeTeachingPeriods: true, maxDailyTeachingPeriods: true, maxConsecutiveTeachingPeriods: true },
    }),
  ]);

  const teacherMap = new Map(teachers.map((t) => [t.id, t]));
  const teacherAttendance = new Map<string, "PRESENT" | "ABSENT" | "LATE">();
  for (const row of teacherAttendanceRows) {
    if (row.teacherId) teacherAttendance.set(row.teacherId, row.status);
  }
  const teachersOnLeave = new Set(fullDayLeaves.map((l) => l.teacherId).filter((id): id is string => Boolean(id)));
  const teacherEarlyLeave = new Map(earlyLeaves.map((e) => [e.teacherId, e.leaveAfterPeriod]));

  const todaySlots: TimetableSlotRow[] = slotsRaw.map((s) => ({
    id: s.id,
    sectionId: s.sectionId,
    sectionName: s.section.name,
    className: s.section.class.name,
    period: s.period,
    teacherId: s.teacherId,
    subject: s.subject,
  }));

  const todayArrangements: ArrangementRow[] = arrangementsRaw.map((a) => ({
    id: a.id,
    sectionId: a.sectionId,
    period: a.period,
    subject: a.subject,
    absentTeacherId: a.absentTeacherId,
    substituteTeacherId: a.substituteTeacherId,
  }));

  const periodSchedule: SchoolPeriodRow[] = periodScheduleRows.map((p) => ({
    periodNumber: p.periodNumber,
    label: p.label,
    startTime: p.startTime,
    endTime: p.endTime,
    isInstructional: p.isInstructional,
  }));

  const periodState = resolveCurrentPeriod({
    timeOfDay,
    dbDay,
    timetableWorkingDays: school.timetableWorkingDays,
    periods: periodSchedule,
  });

  const workloadDefaults: SchoolWorkloadDefaults = {
    timetableWorkingDays: school.timetableWorkingDays,
    periodsPerDay: school.periodsPerDay,
    defaultMaxWeeklyTeachingPeriods: school.defaultMaxWeeklyTeachingPeriods,
    defaultMinFreeTeachingPeriods: school.defaultMinFreeTeachingPeriods,
    defaultMaxDailyTeachingPeriods: school.defaultMaxDailyTeachingPeriods,
    defaultMaxConsecutiveTeachingPeriods: school.defaultMaxConsecutiveTeachingPeriods,
  };
  const teacherWorkloadOverrides = new Map<string, TeacherWorkloadOverrideFields>(
    workloadOverrideRows.map((o) => [
      o.teacherId,
      {
        maxWeeklyTeachingPeriods: o.maxWeeklyTeachingPeriods,
        minFreeTeachingPeriods: o.minFreeTeachingPeriods,
        maxDailyTeachingPeriods: o.maxDailyTeachingPeriods,
        maxConsecutiveTeachingPeriods: o.maxConsecutiveTeachingPeriods,
      },
    ])
  );

  return {
    schoolId,
    dateKey,
    timeOfDay,
    dbDay,
    dateOnly,
    timetableWorkingDays: school.timetableWorkingDays,
    periodsPerDay: school.periodsPerDay,
    workloadDefaults,
    teacherWorkloadOverrides,
    periodSchedule,
    periodState,
    teachers: teacherMap,
    teacherAttendance,
    teachersOnLeave,
    teacherEarlyLeave,
    todaySlots,
    todayArrangements,
    sections: sections.map((s) => ({ id: s.id, name: s.name, classId: s.classId, className: s.class.name })),
  };
}
