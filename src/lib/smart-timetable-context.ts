/**
 * Smart Timetable — batched generation context loader (PART 25 / PART 27).
 *
 * Everything the constraint engine, recommendation engine, slot engine, and
 * generator need is loaded ONCE here, batched (no query inside any per-teacher
 * or per-slot loop). Downstream code operates purely on the in-memory maps
 * this builds.
 *
 * Occupancy semantics (PART 17 / PART 20 "whole-school conflict awareness"):
 *   - teacherOccupancy = LIVE TimetableSlot rows for the WHOLE SCHOOL, EXCLUDING
 *     any row belonging to a section currently being generated/edited (those
 *     rows are about to be replaced by this draft on publish and must not
 *     block the draft from reusing that exact slot) UNION any TimetableDraftSlot
 *     rows belonging to the explicit batch of drafts passed in (this draft,
 *     plus any other drafts intentionally linked into the same multi-section
 *     generation run). An unrelated, unpublished draft from another session is
 *     NEVER included unless explicitly passed in — so an abandoned draft from
 *     months ago can never globally block a teacher (PART 17/20 documented rule).
 *   - sectionOccupancy = the target section's OWN existing batch-draft slots
 *     (used for the H2 duplicate-class-slot check while building a draft).
 */

import { prisma } from "@/lib/prisma";
import type { SchoolWorkloadDefaults, TeacherWorkloadOverrideFields } from "@/lib/teacher-workload-rules";

export interface TeacherInfo {
  id: string;
  name: string;
  subject: string | null;
  eligibleSubjects: Set<string>;
  workloadOverride: TeacherWorkloadOverrideFields | null;
}

export interface GenerationContext {
  schoolId: string;
  workingDays: number;
  periodsPerDay: number;
  capacity: number;
  schoolDefaults: SchoolWorkloadDefaults;
  teachers: Map<string, TeacherInfo>;
  /** teacherId -> set of "day-period" keys the teacher is occupied at. */
  teacherOccupancy: Map<string, Set<string>>;
  /** sectionId -> set of "day-period" keys already filled in that section's batch-draft slots. */
  sectionOccupancy: Map<string, Set<string>>;
}

function slotKey(day: number, period: number): string {
  return `${day}-${period}`;
}

export function normalizeSubjectName(name: string): string {
  return name.trim().toLowerCase();
}

export function isTeacherEligibleForSubject(teacher: TeacherInfo, subjectName: string): boolean {
  const wanted = normalizeSubjectName(subjectName);
  if (teacher.eligibleSubjects.size > 0) return teacher.eligibleSubjects.has(wanted);
  return teacher.subject ? normalizeSubjectName(teacher.subject) === wanted : false;
}

/** Distinct weekly periods the teacher is currently occupied for (see occupancy semantics above). */
export function getTeacherWeeklyPeriodCount(ctx: GenerationContext, teacherId: string): number {
  return ctx.teacherOccupancy.get(teacherId)?.size ?? 0;
}

/** Periods the teacher is occupied for on one specific day, sorted ascending. */
export function getTeacherDayPeriods(ctx: GenerationContext, teacherId: string, day: number): number[] {
  const occ = ctx.teacherOccupancy.get(teacherId);
  if (!occ) return [];
  const periods: number[] = [];
  for (const key of occ) {
    const [d, p] = key.split("-").map(Number);
    if (d === day) periods.push(p);
  }
  return periods.sort((a, b) => a - b);
}

/** Longest consecutive run length the teacher would have on `day` if `period` were also assigned to them. */
export function projectedConsecutiveRun(ctx: GenerationContext, teacherId: string, day: number, period: number): number {
  const periods = new Set(getTeacherDayPeriods(ctx, teacherId, day));
  periods.add(period);
  let longest = 0;
  let current = 0;
  let prev: number | null = null;
  for (const p of [...periods].sort((a, b) => a - b)) {
    current = prev !== null && p === prev + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    prev = p;
  }
  return longest;
}

export function isTeacherBusy(ctx: GenerationContext, teacherId: string, day: number, period: number): boolean {
  return ctx.teacherOccupancy.get(teacherId)?.has(slotKey(day, period)) ?? false;
}

export function isSectionSlotFilled(ctx: GenerationContext, sectionId: string, day: number, period: number): boolean {
  return ctx.sectionOccupancy.get(sectionId)?.has(slotKey(day, period)) ?? false;
}

/** Marks a slot as occupied in-memory (called as the generator/recommendation flow places tentative assignments within one request). */
export function reserveSlot(ctx: GenerationContext, teacherId: string | null, sectionId: string, day: number, period: number): void {
  if (teacherId) {
    if (!ctx.teacherOccupancy.has(teacherId)) ctx.teacherOccupancy.set(teacherId, new Set());
    ctx.teacherOccupancy.get(teacherId)!.add(slotKey(day, period));
  }
  if (!ctx.sectionOccupancy.has(sectionId)) ctx.sectionOccupancy.set(sectionId, new Set());
  ctx.sectionOccupancy.get(sectionId)!.add(slotKey(day, period));
}

export async function loadGenerationContext(args: {
  schoolId: string;
  /** Sections currently being generated/edited — their LIVE slots are excluded from teacherOccupancy. */
  targetSectionIds: string[];
  /** Draft ids whose slots count as occupancy (this draft + any explicitly linked batch drafts). */
  batchDraftIds?: string[];
}): Promise<GenerationContext> {
  const { schoolId, targetSectionIds, batchDraftIds = [] } = args;

  const [school, teachers, eligibilities, overrides, liveSlots, draftSlots] = await Promise.all([
    prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        timetableWorkingDays: true,
        periodsPerDay: true,
        defaultMaxWeeklyTeachingPeriods: true,
        defaultMinFreeTeachingPeriods: true,
        defaultMaxDailyTeachingPeriods: true,
        defaultMaxConsecutiveTeachingPeriods: true,
      },
    }),
    prisma.teacher.findMany({
      where: { schoolId, isDeleted: false },
      select: { id: true, name: true, subject: true },
      orderBy: { id: "asc" },
    }),
    prisma.teacherSubjectEligibility.findMany({
      where: { schoolId },
      select: { teacherId: true, subjectName: true },
    }),
    prisma.teacherWorkloadOverride.findMany({
      where: { schoolId },
      select: {
        teacherId: true,
        maxWeeklyTeachingPeriods: true,
        minFreeTeachingPeriods: true,
        maxDailyTeachingPeriods: true,
        maxConsecutiveTeachingPeriods: true,
      },
    }),
    prisma.timetableSlot.findMany({
      where: { schoolId, teacherId: { not: null }, NOT: { sectionId: { in: targetSectionIds } } },
      select: { teacherId: true, dayOfWeek: true, period: true },
    }),
    batchDraftIds.length > 0
      ? prisma.timetableDraftSlot.findMany({
          where: { draftId: { in: batchDraftIds }, teacherId: { not: null } },
          select: { teacherId: true, dayOfWeek: true, period: true, draft: { select: { sectionId: true } } },
        })
      : Promise.resolve([]),
  ]);

  const eligibilityByTeacher = new Map<string, Set<string>>();
  for (const e of eligibilities) {
    if (!eligibilityByTeacher.has(e.teacherId)) eligibilityByTeacher.set(e.teacherId, new Set());
    eligibilityByTeacher.get(e.teacherId)!.add(normalizeSubjectName(e.subjectName));
  }

  const overrideByTeacher = new Map<string, TeacherWorkloadOverrideFields>();
  for (const o of overrides) overrideByTeacher.set(o.teacherId, o);

  const teacherMap = new Map<string, TeacherInfo>();
  for (const t of teachers) {
    teacherMap.set(t.id, {
      id: t.id,
      name: t.name,
      subject: t.subject,
      eligibleSubjects: eligibilityByTeacher.get(t.id) ?? new Set(),
      workloadOverride: overrideByTeacher.get(t.id) ?? null,
    });
  }

  const teacherOccupancy = new Map<string, Set<string>>();
  const sectionOccupancy = new Map<string, Set<string>>();

  for (const s of liveSlots) {
    if (!s.teacherId) continue;
    if (!teacherOccupancy.has(s.teacherId)) teacherOccupancy.set(s.teacherId, new Set());
    teacherOccupancy.get(s.teacherId)!.add(slotKey(s.dayOfWeek, s.period));
  }
  for (const s of draftSlots) {
    if (s.teacherId) {
      if (!teacherOccupancy.has(s.teacherId)) teacherOccupancy.set(s.teacherId, new Set());
      teacherOccupancy.get(s.teacherId)!.add(slotKey(s.dayOfWeek, s.period));
    }
    const sectionId = s.draft.sectionId;
    if (!sectionOccupancy.has(sectionId)) sectionOccupancy.set(sectionId, new Set());
    sectionOccupancy.get(sectionId)!.add(slotKey(s.dayOfWeek, s.period));
  }

  return {
    schoolId,
    workingDays: school.timetableWorkingDays,
    periodsPerDay: school.periodsPerDay,
    capacity: school.timetableWorkingDays * school.periodsPerDay,
    schoolDefaults: school,
    teachers: teacherMap,
    teacherOccupancy,
    sectionOccupancy,
  };
}

/** Builds a fresh generation context for one section, including the given draft's own slots as occupancy (so recommendations reflect work-in-progress). */
export async function buildSectionContext(args: { schoolId: string; sectionId: string; draftId?: string }): Promise<GenerationContext> {
  return loadGenerationContext({
    schoolId: args.schoolId,
    targetSectionIds: [args.sectionId],
    batchDraftIds: args.draftId ? [args.draftId] : [],
  });
}

/** This draft's own current slots (day/period/subjectName only) — used for soft-scoring context (spread/consecutive checks). */
export async function getSectionDraftSlots(draftId: string | undefined): Promise<{ day: number; period: number; subjectName: string | null }[]> {
  if (!draftId) return [];
  const slots = await prisma.timetableDraftSlot.findMany({
    where: { draftId },
    select: { dayOfWeek: true, period: true, subjectName: true },
  });
  return slots.map((s) => ({ day: s.dayOfWeek, period: s.period, subjectName: s.subjectName }));
}
