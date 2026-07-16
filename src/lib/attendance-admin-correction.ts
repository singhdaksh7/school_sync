/**
 * Admin/operational-actor emergency correction — an EXACT, audited fix to
 * specific students on an already-SUBMITTED session, with no teacher request
 * involved. Also used (with source="LEAVE_RECONCILIATION") when an admin
 * applies a fix surfaced by the leave/attendance reconciliation attention
 * list. Never reopens the session — status stays SUBMITTED throughout.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { recordAttendanceHistory } from "@/lib/attendance-history";
import { logAudit } from "@/lib/audit";
import type { AttendanceStatusValue } from "@/lib/attendance-sessions";

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

export interface AdminCorrectionItem {
  studentId: string;
  requestedStatus: AttendanceStatusValue;
}

export type AdminCorrectionResult =
  | { ok: true; updatedCount: number }
  | { ok: false; code: "SESSION_NOT_SUBMITTED" }
  | { ok: false; code: "OUT_OF_SCOPE" }
  | { ok: false; code: "DUPLICATE_STUDENT" }
  | { ok: false; code: "MISSING_ATTENDANCE_ROW" };

export async function applyAdminAttendanceCorrection(args: {
  schoolId: string;
  sectionId: string;
  date: Date;
  actorUserId: string;
  actorRole?: string | null;
  reason: string;
  source: "ADMIN_EMERGENCY" | "LEAVE_RECONCILIATION";
  items: AdminCorrectionItem[];
}): Promise<AdminCorrectionResult> {
  const studentIds = args.items.map((i) => i.studentId);
  if (new Set(studentIds).size !== studentIds.length) return { ok: false, code: "DUPLICATE_STUDENT" };

  return withSessionLock(args.schoolId, args.sectionId, args.date, async (tx) => {
    const session = await tx.attendanceSession.findUnique({ where: { schoolId_sectionId_date: { schoolId: args.schoolId, sectionId: args.sectionId, date: args.date } } });
    if (!session || session.status !== "SUBMITTED") return { ok: false, code: "SESSION_NOT_SUBMITTED" };

    if (studentIds.length > 0) {
      const eligibleCount = await tx.student.count({ where: { id: { in: studentIds }, schoolId: args.schoolId, sectionId: args.sectionId } });
      if (eligibleCount !== new Set(studentIds).size) return { ok: false, code: "OUT_OF_SCOPE" };
    }

    const historyEntries = [];
    for (const item of args.items) {
      const current = await tx.attendance.findUnique({ where: { date_studentId: { date: args.date, studentId: item.studentId } } });
      if (!current) return { ok: false, code: "MISSING_ATTENDANCE_ROW" } as const;

      await tx.attendance.update({ where: { id: current.id }, data: { status: item.requestedStatus } });
      historyEntries.push({
        schoolId: args.schoolId,
        attendanceId: current.id,
        studentId: item.studentId,
        sectionId: args.sectionId,
        date: args.date,
        oldStatus: current.status as AttendanceStatusValue,
        newStatus: item.requestedStatus,
        actorId: args.actorUserId,
        actorRole: args.actorRole ?? null,
        source: args.source,
        reason: args.reason,
      });
    }

    await recordAttendanceHistory(tx, historyEntries);

    await logAudit({
      action: "ATTENDANCE_ADMIN_CORRECTED",
      entityType: "AttendanceSession",
      entityId: session.id,
      metadata: { sectionId: args.sectionId, date: args.date.toISOString().slice(0, 10), studentCount: args.items.length, source: args.source },
      userId: args.actorUserId,
      schoolId: args.schoolId,
      actorRole: args.actorRole ?? null,
    });

    return { ok: true, updatedCount: args.items.length };
  });
}

export interface ReconciliationItem {
  leaveRequestId: string;
  studentId: string;
  sectionId: string;
  date: string;
  currentStatus: AttendanceStatusValue;
}

/**
 * Approved STUDENT leave whose date range overlaps an already-SUBMITTED
 * attendance date, where the submitted status is not ON_LEAVE — surfaced as
 * an admin attention item rather than silently rewritten (rule: late leave
 * approval must never silently modify locked attendance).
 */
export async function listAttendanceReconciliationItems(schoolId: string): Promise<ReconciliationItem[]> {
  const approvedLeaves = await prisma.leaveRequest.findMany({
    where: { schoolId, type: "STUDENT", status: "APPROVED" },
    select: { id: true, studentId: true, fromDate: true, toDate: true, student: { select: { sectionId: true } } },
  });
  if (approvedLeaves.length === 0) return [];

  const items: ReconciliationItem[] = [];
  for (const leave of approvedLeaves) {
    if (!leave.studentId || !leave.student) continue;
    const sectionId = leave.student.sectionId;

    const submittedSessions = await prisma.attendanceSession.findMany({
      where: { schoolId, sectionId, status: "SUBMITTED", date: { gte: leave.fromDate, lte: leave.toDate } },
      select: { date: true },
    });
    if (submittedSessions.length === 0) continue;

    const dates = submittedSessions.map((s) => s.date);
    const mismatched = await prisma.attendance.findMany({
      where: { schoolId, studentId: leave.studentId, type: "STUDENT", date: { in: dates }, status: { not: "ON_LEAVE" } },
      select: { studentId: true, date: true, status: true },
    });

    for (const row of mismatched) {
      items.push({
        leaveRequestId: leave.id,
        studentId: row.studentId!,
        sectionId,
        date: row.date.toISOString().slice(0, 10),
        currentStatus: row.status as AttendanceStatusValue,
      });
    }
  }
  return items;
}
