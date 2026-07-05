/**
 * School Operations Command Center — Teacher Today Status Engine (PART 5) and
 * Teacher Status Board (PART 6). Consumes the shared
 * `classifyTodayLectures` output (operations-lecture-coverage.ts) rather than
 * re-deriving normal/substituted/uncovered independently.
 *
 * Precedence (PART 5/29): an approved full-day leave always resolves
 * ON_LEAVE, even if a conflicting Attendance row somehow exists — approved
 * leave has operational precedence over any manually-marked attendance.
 */

import type { TodayOperationsContext } from "@/lib/operations-context";
import { classifyTodayLectures, type LectureClassification } from "@/lib/operations-lecture-coverage";

export type BaseAttendanceStatus = "PRESENT" | "ABSENT" | "ON_LEAVE" | "NOT_MARKED";
export type OperationalStatus = "IN_CLASS" | "FREE" | "UNAVAILABLE" | "NOT_MARKED";

export interface AssignmentSummary {
  sectionId: string;
  className: string;
  sectionName: string;
  subject: string | null;
  period: number;
}

export interface TeacherTodayStatus {
  teacherId: string;
  teacherName: string;
  baseStatus: BaseAttendanceStatus;
  operationalStatus: OperationalStatus;
  todayScheduledPeriods: number;
  todayCoveredPeriods: number;
  todayFreePeriods: number;
  currentAssignment: AssignmentSummary | null;
  nextAssignment: AssignmentSummary | null;
  onApprovedLeave: boolean;
  substitutingToday: AssignmentSummary[];
  warnings: string[];
}

function resolveBaseStatus(ctx: TodayOperationsContext, teacherId: string): BaseAttendanceStatus {
  if (ctx.teachersOnLeave.has(teacherId)) return "ON_LEAVE";
  const attendance = ctx.teacherAttendance.get(teacherId);
  if (attendance === "ABSENT") return "ABSENT";
  if (attendance === "PRESENT" || attendance === "LATE") return "PRESENT";
  return "NOT_MARKED";
}

function toAssignment(l: LectureClassification): AssignmentSummary {
  return { sectionId: l.sectionId, className: l.className, sectionName: l.sectionName, subject: l.subject, period: l.period };
}

/** Builds the full per-teacher status list for every active teacher — the shared source both the board and the summary counts consume. */
export function computeTeacherTodayStatuses(ctx: TodayOperationsContext): TeacherTodayStatus[] {
  const allLectures = classifyTodayLectures(ctx);
  const currentPeriodNumber = ctx.periodState.currentPeriod?.periodNumber ?? null;
  const nextPeriodNumber = ctx.periodState.nextPeriod?.periodNumber ?? null;

  const ownSlotsByTeacher = new Map<string, LectureClassification[]>();
  const substitutionsByTeacher = new Map<string, LectureClassification[]>();
  for (const lecture of allLectures) {
    if (lecture.originalTeacherId) {
      const list = ownSlotsByTeacher.get(lecture.originalTeacherId) ?? [];
      list.push(lecture);
      ownSlotsByTeacher.set(lecture.originalTeacherId, list);
    }
    if (lecture.status === "SUBSTITUTED" && lecture.effectiveTeacherId && lecture.effectiveTeacherId !== lecture.originalTeacherId) {
      const list = substitutionsByTeacher.get(lecture.effectiveTeacherId) ?? [];
      list.push(lecture);
      substitutionsByTeacher.set(lecture.effectiveTeacherId, list);
    }
  }

  const statuses: TeacherTodayStatus[] = [];
  for (const [teacherId, teacher] of ctx.teachers) {
    const baseStatus = resolveBaseStatus(ctx, teacherId);
    const ownSlots = ownSlotsByTeacher.get(teacherId) ?? [];
    const substitutions = substitutionsByTeacher.get(teacherId) ?? [];
    const todayScheduledPeriods = ownSlots.length;
    const todayCoveredPeriods = ownSlots.filter((l) => l.status === "SUBSTITUTED").length;
    const effectivePeriodsToday = ownSlots.filter((l) => l.status !== "SUBSTITUTED").length + substitutions.length;
    const todayFreePeriods = Math.max(0, ctx.periodsPerDay - effectivePeriodsToday);

    let operationalStatus: OperationalStatus;
    let currentAssignment: AssignmentSummary | null = null;
    let nextAssignment: AssignmentSummary | null = null;

    if (baseStatus === "ON_LEAVE" || baseStatus === "ABSENT") {
      operationalStatus = "UNAVAILABLE";
    } else if (baseStatus === "NOT_MARKED") {
      operationalStatus = "NOT_MARKED";
    } else {
      const currentLecture =
        currentPeriodNumber !== null
          ? allLectures.find((l) => l.period === currentPeriodNumber && l.effectiveTeacherId === teacherId)
          : undefined;
      operationalStatus = currentLecture ? "IN_CLASS" : "FREE";
      if (currentLecture) currentAssignment = toAssignment(currentLecture);
    }

    if (nextPeriodNumber !== null) {
      const nextLecture = allLectures.find((l) => l.period === nextPeriodNumber && l.effectiveTeacherId === teacherId);
      if (nextLecture) nextAssignment = toAssignment(nextLecture);
    }

    const warnings: string[] = [];
    if (baseStatus === "PRESENT" && todayScheduledPeriods === 0 && substitutions.length === 0) {
      warnings.push("NO_LECTURES_TODAY");
    }

    statuses.push({
      teacherId,
      teacherName: teacher.name,
      baseStatus,
      operationalStatus,
      todayScheduledPeriods,
      todayCoveredPeriods,
      todayFreePeriods,
      currentAssignment,
      nextAssignment,
      onApprovedLeave: baseStatus === "ON_LEAVE",
      substitutingToday: substitutions.map(toAssignment),
      warnings,
    });
  }

  statuses.sort((a, b) => a.teacherName.localeCompare(b.teacherName) || a.teacherId.localeCompare(b.teacherId));
  return statuses;
}

// ── Teacher Status Board (PART 6) ─────────────────────────────────────────────
export interface TeacherStatusSummary {
  totalActiveTeachers: number;
  present: number;
  absent: number;
  onLeave: number;
  notMarked: number;
  currentlyInClass: number;
  currentlyFree: number;
}

export function summarizeTeacherStatuses(statuses: TeacherTodayStatus[]): TeacherStatusSummary {
  return {
    totalActiveTeachers: statuses.length,
    present: statuses.filter((s) => s.baseStatus === "PRESENT").length,
    absent: statuses.filter((s) => s.baseStatus === "ABSENT").length,
    onLeave: statuses.filter((s) => s.baseStatus === "ON_LEAVE").length,
    notMarked: statuses.filter((s) => s.baseStatus === "NOT_MARKED").length,
    currentlyInClass: statuses.filter((s) => s.operationalStatus === "IN_CLASS").length,
    currentlyFree: statuses.filter((s) => s.operationalStatus === "FREE").length,
  };
}

export type TeacherStatusFilter = "PRESENT" | "ABSENT" | "ON_LEAVE" | "NOT_MARKED" | "IN_CLASS" | "FREE" | "ALL";

export interface TeacherStatusBoardQuery {
  filter?: TeacherStatusFilter;
  search?: string;
  skip: number;
  take: number;
}

export function filterAndPaginateTeacherStatuses(statuses: TeacherTodayStatus[], query: TeacherStatusBoardQuery): { data: TeacherTodayStatus[]; total: number } {
  let filtered = statuses;
  if (query.filter && query.filter !== "ALL") {
    filtered = filtered.filter((s) => s.baseStatus === query.filter || s.operationalStatus === query.filter);
  }
  if (query.search?.trim()) {
    const needle = query.search.trim().toLowerCase();
    filtered = filtered.filter((s) => s.teacherName.toLowerCase().includes(needle));
  }
  const total = filtered.length;
  const data = filtered.slice(query.skip, query.skip + query.take);
  return { data, total };
}
