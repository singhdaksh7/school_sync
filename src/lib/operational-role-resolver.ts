/**
 * Teacher Operations Head & Automatic Delegation (Phase 3) — the effective
 * assignee resolver (PART 5-9). Purely dynamic: no permission row is ever
 * copied onto an alternate, no cron/worker/manual activation exists. Every
 * call recomputes the current effective head from CURRENT facts.
 *
 * Availability facts are read directly (LeaveRequest APPROVED + Attendance
 * type=TEACHER + Teacher.isDeleted) — the SAME data model the School
 * Operations Command Center phase already established, but queried directly
 * here rather than via `loadTodayOperationsContext` (operations-context.ts):
 * that loader batches a whole school's roster/timetable/arrangements for a
 * dashboard render, which would be wasteful for this resolver's hot,
 * per-request authorization path where only a handful of chain teacherIds'
 * facts are ever needed. `resolveSchoolTodayDateOnly` (the same school-local
 * date resolution) IS reused directly.
 */

import { prisma } from "@/lib/prisma";
import { resolveSchoolTodayDateOnly } from "@/lib/operations-context";
import { OPERATIONAL_ROLE_TYPES, type OperationalRoleType } from "@/lib/operational-roles";

export type { OperationalRoleType };
export { OPERATIONAL_ROLE_TYPES };

/** Stable reason codes (PART 7) — authorization/UI must never depend on English text. */
export type AvailabilityReasonCode =
  | "ASSIGNMENT_DISABLED"
  | "ASSIGNMENT_NOT_STARTED"
  | "ASSIGNMENT_ENDED"
  | "TEACHER_DELETED"
  | "TEACHER_INACTIVE"
  | "APPROVED_LEAVE"
  | "MARKED_ABSENT"
  | "AVAILABLE"
  | "FIRST_AVAILABLE"
  | "NO_ASSIGNMENTS_CONFIGURED"
  | "NO_AVAILABLE_ASSIGNEE";

export type AssignmentState = "ACTIVE" | "STANDBY" | "UNAVAILABLE";

export interface ChainEntry {
  assignmentId: string;
  teacherId: string;
  teacherName: string;
  priority: number;
  isEnabled: boolean;
  assignmentState: AssignmentState;
  reasonCode: AvailabilityReasonCode;
  /** Informational only — NEVER a reason for failover (PART 6). */
  attendanceNotMarked: boolean;
}

export interface EffectiveOperationalRoleResult {
  roleType: OperationalRoleType;
  dateKey: string;
  effectiveTeacher: { id: string; name: string } | null;
  effectiveAssignmentId: string | null;
  effectivePriority: number | null;
  assignmentType: "PRIMARY" | "ALTERNATE" | null;
  primaryTeacher: { id: string; name: string } | null;
  reasonCode: AvailabilityReasonCode;
  chain: ChainEntry[];
}

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Resolves the current effective assignee for one (schoolId, roleType) at a
 * given instant. Deterministic: same schoolId/roleType/at + same underlying
 * facts always yields the same result — priority ASC is the only ordering,
 * never `createdAt` (PART 5: "not an ambiguous business priority").
 */
export async function resolveEffectiveOperationalRole(args: {
  schoolId: string;
  roleType: OperationalRoleType;
  at?: Date;
}): Promise<EffectiveOperationalRoleResult> {
  const { schoolId, roleType } = args;
  const at = args.at ?? new Date();
  const dateOnly = await resolveSchoolTodayDateOnly(schoolId, at);
  const dateKey = dateKeyOf(dateOnly);

  const assignments = await prisma.operationalRoleAssignment.findMany({
    where: { schoolId, roleType },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    include: { teacher: { select: { id: true, name: true, isDeleted: true } } },
  });

  if (assignments.length === 0) {
    return {
      roleType,
      dateKey,
      effectiveTeacher: null,
      effectiveAssignmentId: null,
      effectivePriority: null,
      assignmentType: null,
      primaryTeacher: null,
      reasonCode: "NO_ASSIGNMENTS_CONFIGURED",
      chain: [],
    };
  }

  const teacherIds = assignments.map((a) => a.teacherId);
  const [leaveRows, attendanceRows] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { schoolId, type: "TEACHER", status: "APPROVED", teacherId: { in: teacherIds }, fromDate: { lte: dateOnly }, toDate: { gte: dateOnly } },
      select: { teacherId: true },
    }),
    prisma.attendance.findMany({
      where: { schoolId, type: "TEACHER", date: dateOnly, teacherId: { in: teacherIds } },
      select: { teacherId: true, status: true },
    }),
  ]);
  const onLeave = new Set(leaveRows.map((l) => l.teacherId).filter((id): id is string => Boolean(id)));
  const attendanceByTeacher = new Map(attendanceRows.map((a) => [a.teacherId, a.status]));

  const chain: ChainEntry[] = [];
  let effectiveIndex = -1;

  for (const a of assignments) {
    let state: AssignmentState;
    let reasonCode: AvailabilityReasonCode;

    if (!a.isEnabled) {
      state = "UNAVAILABLE";
      reasonCode = "ASSIGNMENT_DISABLED";
    } else if (a.effectiveFrom && dateOnly < a.effectiveFrom) {
      state = "UNAVAILABLE";
      reasonCode = "ASSIGNMENT_NOT_STARTED";
    } else if (a.effectiveUntil && dateOnly > a.effectiveUntil) {
      state = "UNAVAILABLE";
      reasonCode = "ASSIGNMENT_ENDED";
    } else if (a.teacher.isDeleted) {
      state = "UNAVAILABLE";
      reasonCode = "TEACHER_DELETED";
    } else if (onLeave.has(a.teacherId)) {
      state = "UNAVAILABLE";
      reasonCode = "APPROVED_LEAVE";
    } else if (attendanceByTeacher.get(a.teacherId) === "ABSENT") {
      state = "UNAVAILABLE";
      reasonCode = "MARKED_ABSENT";
    } else if (effectiveIndex === -1) {
      state = "ACTIVE";
      reasonCode = "FIRST_AVAILABLE";
    } else {
      state = "STANDBY";
      reasonCode = "AVAILABLE";
    }

    if (state === "ACTIVE") effectiveIndex = chain.length;

    chain.push({
      assignmentId: a.id,
      teacherId: a.teacherId,
      teacherName: a.teacher.name,
      priority: a.priority,
      isEnabled: a.isEnabled,
      assignmentState: state,
      reasonCode,
      // NOT_MARKED never blocks availability — it's surfaced as a flag only.
      // Phase 2's Needs Attention engine (TEACHER_STATUS_NOT_MARKED) already
      // owns alerting on this; no second alert system is created here.
      attendanceNotMarked: state !== "UNAVAILABLE" && !attendanceByTeacher.has(a.teacherId),
    });
  }

  const primaryAssignment = assignments.find((a) => a.priority === 0) ?? null;
  const primaryTeacher = primaryAssignment ? { id: primaryAssignment.teacherId, name: primaryAssignment.teacher.name } : null;

  if (effectiveIndex === -1) {
    return {
      roleType,
      dateKey,
      effectiveTeacher: null,
      effectiveAssignmentId: null,
      effectivePriority: null,
      assignmentType: null,
      primaryTeacher,
      reasonCode: "NO_AVAILABLE_ASSIGNEE",
      chain,
    };
  }

  const effective = assignments[effectiveIndex];
  return {
    roleType,
    dateKey,
    effectiveTeacher: { id: effective.teacherId, name: effective.teacher.name },
    effectiveAssignmentId: effective.id,
    effectivePriority: effective.priority,
    assignmentType: effective.priority === 0 ? "PRIMARY" : "ALTERNATE",
    primaryTeacher,
    reasonCode: chain[effectiveIndex].reasonCode,
    chain,
  };
}

/**
 * PART 25 signal for the Needs Attention engine's `noActiveOperationsHead`
 * input — true ONLY when TEACHER_OPERATIONS has at least one assignment
 * configured AND none is currently available. A school that never configured
 * the role always gets `false` here (never a spurious attention item).
 */
export async function isOperationsHeadUnavailable(schoolId: string, at?: Date): Promise<boolean> {
  const resolved = await resolveEffectiveOperationalRole({ schoolId, roleType: "TEACHER_OPERATIONS", at });
  return resolved.chain.length > 0 && resolved.effectiveTeacher === null;
}
