import { prisma } from "@/lib/prisma";

export const DEFAULT_TEACHER_ATTENDANCE_CUTOFF = "09:30";

export function isValidCutoffTime(value: unknown) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeCutoffTime(value: unknown) {
  return isValidCutoffTime(value) ? (value as string) : DEFAULT_TEACHER_ATTENDANCE_CUTOFF;
}

export function getTodayDateOnly(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getCutoffDateForToday(cutoffTime: string, now = new Date()) {
  const [hours, minutes] = normalizeCutoffTime(cutoffTime).split(":").map(Number);
  const cutoff = getTodayDateOnly(now);
  cutoff.setHours(hours, minutes, 0, 0);
  return cutoff;
}

export function hasCutoffPassed(cutoffTime: string, now = new Date()) {
  return now >= getCutoffDateForToday(cutoffTime, now);
}

export async function runTeacherAutoAbsent(schoolId: string, markedById: string, now = new Date()) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, teacherAttendanceCutoffTime: true },
  });
  if (!school) return { error: "School not found" as const };

  const cutoffTime = normalizeCutoffTime(school.teacherAttendanceCutoffTime);
  if (!hasCutoffPassed(cutoffTime, now)) {
    return {
      error: "Teacher attendance cutoff has not passed yet" as const,
      cutoffTime,
      cutoffPassed: false,
    };
  }

  const date = getTodayDateOnly(now);
  const [teachers, existing] = await Promise.all([
    prisma.teacher.findMany({
      where: { schoolId, isDeleted: false },
      select: { id: true },
    }),
    prisma.attendance.findMany({
      where: { schoolId, date, type: "TEACHER" },
      select: { teacherId: true },
    }),
  ]);

  const markedTeacherIds = new Set(existing.map((record) => record.teacherId).filter(Boolean));
  const missingTeachers = teachers.filter((teacher) => !markedTeacherIds.has(teacher.id));

  // Phase 4 audit (PART 13): `missingTeachers.length` is the REQUESTED count,
  // computed from a snapshot read — if a concurrent sweep (or a teacher
  // self-marking) inserted one of these rows between that read and this
  // write, `skipDuplicates` silently drops it and the actual insert count is
  // lower. Report Prisma's own `createMany` result (the ACTUAL row count),
  // never the pre-computed candidate list length, so a caller never sees an
  // inflated "created" number.
  let createdAbsent = 0;
  if (missingTeachers.length > 0) {
    const result = await prisma.attendance.createMany({
      data: missingTeachers.map((teacher) => ({
        date,
        type: "TEACHER" as const,
        status: "ABSENT" as const,
        teacherId: teacher.id,
        schoolId,
        markedById,
      })),
      skipDuplicates: true,
    });
    createdAbsent = result.count;
  }

  return {
    cutoffTime,
    cutoffPassed: true,
    checked: teachers.length,
    createdAbsent,
  };
}
