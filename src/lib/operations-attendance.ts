/**
 * School Operations Command Center — student attendance today insights
 * (PART 8) and attendance completion engine (PART 9).
 *
 * Attendance is a per-STUDENT row (`Attendance` type=STUDENT, unique on
 * `(date, studentId)`) — there is no per-section "submitted" flag/session
 * model. Completion is therefore derived by comparing, per section, the
 * count of active students against the count of today's recorded Attendance
 * rows — both DB-side `groupBy` aggregates, never a full Student/Attendance
 * row hydration (PART 9: "do not assume one row per section").
 */

import { prisma } from "@/lib/prisma";

export interface StudentAttendanceSummary {
  total: number;
  present: number;
  absent: number;
  attendancePercentage: number | null;
}

export async function computeStudentAttendanceSummary(schoolId: string, dateOnly: Date): Promise<StudentAttendanceSummary> {
  const [total, byStatus] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.attendance.groupBy({ by: ["status"], where: { schoolId, type: "STUDENT", date: dateOnly }, _count: { _all: true } }),
  ]);
  const present = byStatus.filter((r) => r.status === "PRESENT" || r.status === "LATE").reduce((s, r) => s + r._count._all, 0);
  const absent = byStatus.find((r) => r.status === "ABSENT")?._count._all ?? 0;
  const attendancePercentage = total > 0 ? Math.round((present / total) * 1000) / 10 : null;
  return { total, present, absent, attendancePercentage };
}

export interface SectionAttendanceRow {
  sectionId: string;
  className: string;
  sectionName: string;
  expectedCount: number;
  recordedCount: number;
  presentCount: number;
  missingCount: number;
  completion: "SUBMITTED" | "PARTIAL" | "PENDING";
  presentRate: number | null;
  responsibleTeacherId: string | null;
  responsibleTeacherName: string | null;
  responsibilityUnresolved: boolean;
}

export interface AttendanceCompletionSummary {
  expectedSections: number;
  submittedSections: number;
  partialSections: number;
  pendingSections: number;
  completionPercentage: number | null;
  sections: SectionAttendanceRow[];
}

const LOWEST_ATTENDANCE_LIMIT = 5;

export async function computeAttendanceCompletion(schoolId: string, dateOnly: Date): Promise<AttendanceCompletionSummary> {
  const [sections, expectedRows, recordedRows] = await Promise.all([
    prisma.section.findMany({
      where: { class: { schoolId } },
      select: { id: true, name: true, class: { select: { name: true } }, mentor: { select: { id: true, name: true } } },
    }),
    prisma.student.groupBy({ by: ["sectionId"], where: { schoolId }, _count: { _all: true } }),
    prisma.attendance.groupBy({
      by: ["sectionId", "status"],
      where: { schoolId, type: "STUDENT", date: dateOnly, sectionId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const expectedBySection = new Map(expectedRows.map((r) => [r.sectionId, r._count._all]));
  const recordedBySection = new Map<string, number>();
  const presentBySection = new Map<string, number>();
  for (const row of recordedRows) {
    if (!row.sectionId) continue;
    recordedBySection.set(row.sectionId, (recordedBySection.get(row.sectionId) ?? 0) + row._count._all);
    if (row.status === "PRESENT" || row.status === "LATE") {
      presentBySection.set(row.sectionId, (presentBySection.get(row.sectionId) ?? 0) + row._count._all);
    }
  }

  const rows: SectionAttendanceRow[] = sections
    .filter((s) => (expectedBySection.get(s.id) ?? 0) > 0) // only sections with active students are "expected" to submit
    .map((s) => {
      const expectedCount = expectedBySection.get(s.id) ?? 0;
      const recordedCount = recordedBySection.get(s.id) ?? 0;
      const presentCount = presentBySection.get(s.id) ?? 0;
      const completion: SectionAttendanceRow["completion"] =
        recordedCount === 0 ? "PENDING" : recordedCount >= expectedCount ? "SUBMITTED" : "PARTIAL";
      return {
        sectionId: s.id,
        className: s.class.name,
        sectionName: s.name,
        expectedCount,
        recordedCount,
        presentCount,
        missingCount: Math.max(0, expectedCount - recordedCount),
        completion,
        presentRate: recordedCount > 0 ? Math.round((presentCount / recordedCount) * 1000) / 10 : null,
        responsibleTeacherId: s.mentor?.id ?? null,
        responsibleTeacherName: s.mentor?.name ?? null,
        responsibilityUnresolved: !s.mentor,
      };
    });

  const submittedSections = rows.filter((r) => r.completion === "SUBMITTED").length;
  const partialSections = rows.filter((r) => r.completion === "PARTIAL").length;
  const pendingSections = rows.filter((r) => r.completion === "PENDING").length;
  const expectedSections = rows.length;

  return {
    expectedSections,
    submittedSections,
    partialSections,
    pendingSections,
    completionPercentage: expectedSections > 0 ? Math.round((submittedSections / expectedSections) * 1000) / 10 : null,
    sections: rows,
  };
}

export function lowestAttendanceSections(sections: SectionAttendanceRow[], limit = LOWEST_ATTENDANCE_LIMIT): SectionAttendanceRow[] {
  return sections
    .filter((s) => s.presentRate !== null)
    .sort((a, b) => (a.presentRate ?? 0) - (b.presentRate ?? 0) || a.sectionId.localeCompare(b.sectionId))
    .slice(0, limit);
}

export function pendingOrPartialSections(sections: SectionAttendanceRow[]): SectionAttendanceRow[] {
  return sections.filter((s) => s.completion !== "SUBMITTED");
}
