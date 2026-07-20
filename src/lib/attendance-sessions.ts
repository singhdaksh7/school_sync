/**
 * Attendance v2 — session lifecycle (DRAFT -> SUBMITTED) for mentor-teacher
 * STUDENT attendance. Teacher self-attendance (Attendance.type=TEACHER) has no
 * "section" concept and is NOT governed by AttendanceSession at all.
 *
 * Concurrency: every mutating operation acquires a transaction-scoped
 * Postgres advisory lock keyed by (schoolId, sectionId, date) — same pattern
 * as src/lib/auth-concurrency.ts — so draft writes, submission, and
 * correction approval for the SAME session can never race each other.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getEligibleStudentIds } from "@/lib/attendance-roster";
import { recordAttendanceHistory } from "@/lib/attendance-history";
import { logAudit } from "@/lib/audit";

export type AttendanceStatusValue = "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
export const ATTENDANCE_STATUS_VALUES: AttendanceStatusValue[] = ["PRESENT", "ABSENT", "LATE", "ON_LEAVE"];

function sessionLockKey(schoolId: string, sectionId: string, date: Date): string {
  return `attendance-session:${schoolId}:${sectionId}:${date.toISOString().slice(0, 10)}`;
}

async function withSessionLock<T>(schoolId: string, sectionId: string, date: Date, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const key = sessionLockKey(schoolId, sectionId, date);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
    return fn(tx);
  });
}

async function findOrCreateDraftSession(tx: Prisma.TransactionClient, schoolId: string, sectionId: string, date: Date) {
  const existing = await tx.attendanceSession.findUnique({ where: { schoolId_sectionId_date: { schoolId, sectionId, date } } });
  if (existing) return existing;
  return tx.attendanceSession.create({ data: { schoolId, sectionId, date, status: "DRAFT" } });
}

export interface DraftRecordInput {
  studentId: string;
  status: AttendanceStatusValue;
}

export type SaveDraftResult =
  | { ok: true; sessionStatus: "DRAFT"; recordCount: number }
  | { ok: false; code: "SESSION_LOCKED" }
  | { ok: false; code: "OUT_OF_SCOPE" }
  | { ok: false; code: "DUPLICATE_STUDENT" };

/**
 * Upserts a draft attendance mark for each given student. Only permitted
 * while the session is DRAFT (or does not exist yet, in which case one is
 * created as DRAFT) — a SUBMITTED session rejects every write here with
 * SESSION_LOCKED and changes nothing.
 */
export async function saveAttendanceDraft(args: {
  schoolId: string;
  sectionId: string;
  date: Date;
  actorUserId: string;
  actorRole?: string | null;
  records: DraftRecordInput[];
}): Promise<SaveDraftResult> {
  const studentIds = args.records.map((r) => r.studentId);
  if (new Set(studentIds).size !== studentIds.length) return { ok: false, code: "DUPLICATE_STUDENT" };

  return withSessionLock(args.schoolId, args.sectionId, args.date, async (tx) => {
    const session = await findOrCreateDraftSession(tx, args.schoolId, args.sectionId, args.date);
    if (session.status === "SUBMITTED") return { ok: false, code: "SESSION_LOCKED" };

    if (studentIds.length > 0) {
      const eligibleCount = await tx.student.count({ where: { id: { in: studentIds }, schoolId: args.schoolId, sectionId: args.sectionId } });
      if (eligibleCount !== new Set(studentIds).size) return { ok: false, code: "OUT_OF_SCOPE" };
    }

    for (const record of args.records) {
      const previous = await tx.attendance.findUnique({ where: { date_studentId: { date: args.date, studentId: record.studentId } } });
      const attendance = await tx.attendance.upsert({
        where: { date_studentId: { date: args.date, studentId: record.studentId } },
        create: {
          date: args.date,
          type: "STUDENT",
          status: record.status,
          studentId: record.studentId,
          sectionId: args.sectionId,
          schoolId: args.schoolId,
          markedById: args.actorUserId,
        },
        update: { status: record.status },
      });

      await recordAttendanceHistory(tx, [
        {
          schoolId: args.schoolId,
          attendanceId: attendance.id,
          studentId: record.studentId,
          sectionId: args.sectionId,
          date: args.date,
          oldStatus: (previous?.status as AttendanceStatusValue | undefined) ?? null,
          newStatus: record.status,
          actorId: args.actorUserId,
          actorRole: args.actorRole ?? null,
          source: "DRAFT_MARK",
        },
      ]);
    }

    return { ok: true, sessionStatus: "DRAFT", recordCount: args.records.length };
  });
}

export type SubmitResult =
  | { ok: true; submittedCount: number }
  | { ok: false; code: "ALREADY_SUBMITTED" }
  | { ok: false; code: "INCOMPLETE_ROSTER"; missingStudentIds: string[]; extraStudentIds: string[] };

/**
 * Submits the session: requires every eligible enrolled student in the
 * section to have exactly one Attendance row for this date. On success the
 * session is locked (SUBMITTED) and every teacher write to this
 * (school, section, date) subsequently gets SESSION_LOCKED.
 */
export async function submitAttendanceSession(args: {
  schoolId: string;
  sectionId: string;
  date: Date;
  actorUserId: string;
  actorRole?: string | null;
}): Promise<SubmitResult> {
  return withSessionLock(args.schoolId, args.sectionId, args.date, async (tx) => {
    const session = await findOrCreateDraftSession(tx, args.schoolId, args.sectionId, args.date);
    if (session.status === "SUBMITTED") return { ok: false, code: "ALREADY_SUBMITTED" };

    const [eligibleIds, attendanceRows] = await Promise.all([
      getEligibleStudentIds(args.schoolId, args.sectionId),
      tx.attendance.findMany({ where: { schoolId: args.schoolId, sectionId: args.sectionId, date: args.date, type: "STUDENT" } }),
    ]);

    const eligibleSet = new Set(eligibleIds);
    const markedSet = new Set(attendanceRows.map((r) => r.studentId!));
    const missingStudentIds = eligibleIds.filter((id) => !markedSet.has(id));
    const extraStudentIds = attendanceRows.map((r) => r.studentId!).filter((id) => !eligibleSet.has(id));

    if (missingStudentIds.length > 0 || extraStudentIds.length > 0) {
      return { ok: false, code: "INCOMPLETE_ROSTER", missingStudentIds, extraStudentIds };
    }

    const guarded = await tx.attendanceSession.updateMany({
      where: { id: session.id, status: "DRAFT" },
      data: { status: "SUBMITTED", submittedById: args.actorUserId, submittedAt: new Date() },
    });
    // Guarded update lost the race (another request submitted first, inside
    // the same advisory-lock section this cannot normally happen, but the
    // WHERE clause is kept as defense in depth).
    if (guarded.count !== 1) return { ok: false, code: "ALREADY_SUBMITTED" };

    await recordAttendanceHistory(
      tx,
      attendanceRows.map((row) => ({
        schoolId: args.schoolId,
        attendanceId: row.id,
        studentId: row.studentId!,
        sectionId: args.sectionId,
        date: args.date,
        oldStatus: row.status as AttendanceStatusValue,
        newStatus: row.status as AttendanceStatusValue,
        actorId: args.actorUserId,
        actorRole: args.actorRole ?? null,
        source: "SUBMISSION",
      }))
    );

    await logAudit({
      action: "ATTENDANCE_SUBMITTED",
      entityType: "AttendanceSession",
      entityId: session.id,
      metadata: { sectionId: args.sectionId, date: args.date.toISOString().slice(0, 10), studentCount: attendanceRows.length },
      userId: args.actorUserId,
      schoolId: args.schoolId,
      actorRole: args.actorRole ?? null,
    });

    return { ok: true, submittedCount: attendanceRows.length };
  });
}

/**
 * Approved STUDENT leave overlapping `date`, for students in `sectionId` —
 * used to prefill/suggest ON_LEAVE for students with no explicit draft mark
 * yet. Never persisted by this function; purely a read-time suggestion.
 */
export async function getApprovedLeaveStudentIds(schoolId: string, sectionId: string, date: Date): Promise<Set<string>> {
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      schoolId,
      type: "STUDENT",
      status: "APPROVED",
      fromDate: { lte: date },
      toDate: { gte: date },
      student: { sectionId },
    },
    select: { studentId: true },
  });
  return new Set(leaves.map((l) => l.studentId!).filter(Boolean));
}

export interface AttendanceRosterEntry {
  studentId: string;
  status: AttendanceStatusValue | null;
  suggested: boolean;
}

/**
 * Full teacher-facing view for a (section, date): session status, and for
 * every eligible student either their persisted Attendance status, or — if
 * unmarked and covered by approved leave — a `suggested: true` ON_LEAVE row
 * that is NOT in the database yet (rule: never silently overwrite an
 * explicit draft choice — this only ever fills genuinely unmarked students).
 */
export async function loadAttendanceRosterView(schoolId: string, sectionId: string, date: Date) {
  const [session, eligibleIds, attendanceRows, leaveStudentIds] = await Promise.all([
    prisma.attendanceSession.findUnique({ where: { schoolId_sectionId_date: { schoolId, sectionId, date } } }),
    getEligibleStudentIds(schoolId, sectionId),
    prisma.attendance.findMany({ where: { schoolId, sectionId, date, type: "STUDENT" } }),
    getApprovedLeaveStudentIds(schoolId, sectionId, date),
  ]);

  const byStudent = new Map(attendanceRows.map((r) => [r.studentId!, r.status as AttendanceStatusValue]));
  const roster: AttendanceRosterEntry[] = eligibleIds.map((studentId) => {
    const marked = byStudent.get(studentId);
    if (marked) return { studentId, status: marked, suggested: false };
    if (leaveStudentIds.has(studentId)) return { studentId, status: "ON_LEAVE", suggested: true };
    return { studentId, status: null, suggested: false };
  });

  return {
    sessionStatus: (session?.status ?? "DRAFT") as "DRAFT" | "SUBMITTED",
    submittedAt: session?.submittedAt ?? null,
    submittedById: session?.submittedById ?? null,
    roster,
  };
}
