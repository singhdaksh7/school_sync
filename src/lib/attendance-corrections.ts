/**
 * Teacher-initiated attendance correction requests against an already
 * SUBMITTED session. Deliberately its OWN status/type space — never reuses
 * LeaveStatus — so a correction can never accidentally satisfy a leave check
 * or vice versa.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { recordAttendanceHistory } from "@/lib/attendance-history";
import { logAudit } from "@/lib/audit";
import type { AttendanceStatusValue } from "@/lib/attendance-sessions";
import { createNotificationsBounded, guardianRecipientsForStudents, leadershipRecipientsForSchool, type RecipientRef } from "@/lib/notifications";

function correctionLockKey(correctionId: string): string {
  return `attendance-correction:${correctionId}`;
}

async function withCorrectionLock<T>(correctionId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${correctionLockKey(correctionId)})::bigint)`;
    return fn(tx);
  });
}

export interface CorrectionItemInput {
  studentId: string;
  requestedStatus: AttendanceStatusValue;
}

export type CreateCorrectionResult =
  | { ok: true; correctionRequestId: string }
  | { ok: false; code: "SESSION_NOT_SUBMITTED" }
  | { ok: false; code: "OUT_OF_SCOPE" }
  | { ok: false; code: "DUPLICATE_STUDENT" }
  | { ok: false; code: "NO_OP" }
  | { ok: false; code: "AMBIGUOUS_PENDING_REQUEST" };

/**
 * Only the mentor teacher of `sectionId` may call this (enforced by the
 * route via requireTeacherPermission + mentorSectionId check before this is
 * reached) — this function itself only enforces the DATA-level invariants:
 * session must be submitted, students must belong to this school+section, no
 * duplicates, no no-ops, and no ambiguous overlapping pending request for the
 * same student on the same session.
 */
export async function createCorrectionRequest(args: {
  schoolId: string;
  sectionId: string;
  date: Date;
  /** Teacher.id — the FK stored on the request (matches self-approval checks elsewhere). */
  requestedById: string;
  /** User.id of the same teacher — needed only for the audit log's userId FK. */
  requestedByUserId: string;
  reason: string;
  items: CorrectionItemInput[];
}): Promise<CreateCorrectionResult> {
  const studentIds = args.items.map((i) => i.studentId);
  if (new Set(studentIds).size !== studentIds.length) return { ok: false, code: "DUPLICATE_STUDENT" };

  return prisma.$transaction(async (tx) => {
    const session = await tx.attendanceSession.findUnique({
      where: { schoolId_sectionId_date: { schoolId: args.schoolId, sectionId: args.sectionId, date: args.date } },
    });
    if (!session || session.status !== "SUBMITTED") return { ok: false, code: "SESSION_NOT_SUBMITTED" };

    if (studentIds.length > 0) {
      const eligibleCount = await tx.student.count({ where: { id: { in: studentIds }, schoolId: args.schoolId, sectionId: args.sectionId } });
      if (eligibleCount !== new Set(studentIds).size) return { ok: false, code: "OUT_OF_SCOPE" };
    }

    const currentRows = await tx.attendance.findMany({ where: { schoolId: args.schoolId, sectionId: args.sectionId, date: args.date, studentId: { in: studentIds } } });
    const currentByStudent = new Map(currentRows.map((r) => [r.studentId!, r.status as AttendanceStatusValue]));

    for (const item of args.items) {
      if (currentByStudent.get(item.studentId) === item.requestedStatus) return { ok: false, code: "NO_OP" };
    }

    const existingPending = await tx.attendanceCorrectionItem.findFirst({
      where: {
        studentId: { in: studentIds },
        correctionRequest: { sessionId: session.id, status: "PENDING" },
      },
    });
    if (existingPending) return { ok: false, code: "AMBIGUOUS_PENDING_REQUEST" };

    const created = await tx.attendanceCorrectionRequest.create({
      data: {
        schoolId: args.schoolId,
        sectionId: args.sectionId,
        date: args.date,
        sessionId: session.id,
        requestedById: args.requestedById,
        reason: args.reason,
        status: "PENDING",
        items: {
          create: args.items.map((item) => ({
            studentId: item.studentId,
            originalStatus: currentByStudent.get(item.studentId)!,
            requestedStatus: item.requestedStatus,
          })),
        },
      },
    });

    await logAudit({
      action: "ATTENDANCE_CORRECTION_REQUESTED",
      entityType: "AttendanceCorrectionRequest",
      entityId: created.id,
      metadata: { sectionId: args.sectionId, date: args.date.toISOString().slice(0, 10), itemCount: args.items.length },
      userId: args.requestedByUserId,
      schoolId: args.schoolId,
    });

    // Notify only the users actually authorized to review this request.
    const reviewers = await leadershipRecipientsForSchool(args.schoolId);
    await createNotificationsBounded(tx, {
      schoolId: args.schoolId,
      eventType: "ATTENDANCE_CORRECTION_PENDING_REVIEW",
      entityType: "AttendanceCorrectionRequest",
      entityId: created.id,
      recipients: reviewers,
      metadata: { sectionId: args.sectionId, date: args.date.toISOString().slice(0, 10), itemCount: args.items.length },
    });

    return { ok: true, correctionRequestId: created.id };
  });
}

export type ReviewCorrectionResult =
  | { ok: true; status: "APPROVED" | "REJECTED"; alreadyFinal: boolean }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "SELF_APPROVAL_FORBIDDEN" }
  | { ok: false; code: "STATUS_CONFLICT"; conflictingStudentIds: string[] };

/**
 * Approve or reject a PENDING correction request. Idempotent: calling this
 * again on an already-APPROVED/REJECTED request returns that final state
 * (alreadyFinal: true) WITHOUT re-applying anything — never double-applies.
 * Approval re-verifies every item's recorded originalStatus against the
 * CURRENT Attendance row inside the same lock; any mismatch aborts the whole
 * approval atomically (no partial application) and changes nothing.
 */
export async function reviewCorrectionRequest(args: {
  correctionRequestId: string;
  schoolId: string;
  action: "APPROVE" | "REJECT";
  reviewerUserId: string;
  reviewerRole?: string | null;
  reviewNote?: string | null;
  /** teacherId of the acting user, if the actor is a teacher (for self-approval guard) — null for Owner/Admin. */
  actingTeacherId?: string | null;
}): Promise<ReviewCorrectionResult> {
  return withCorrectionLock(args.correctionRequestId, async (tx) => {
    const request = await tx.attendanceCorrectionRequest.findFirst({
      where: { id: args.correctionRequestId, schoolId: args.schoolId },
      include: { items: true },
    });
    if (!request) return { ok: false, code: "NOT_FOUND" };

    if (request.status !== "PENDING") {
      return { ok: true, status: request.status as "APPROVED" | "REJECTED", alreadyFinal: true };
    }

    if (args.actingTeacherId && request.requestedById === args.actingTeacherId) {
      return { ok: false, code: "SELF_APPROVAL_FORBIDDEN" };
    }

    if (args.action === "REJECT") {
      await tx.attendanceCorrectionRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED", reviewedById: args.reviewerUserId, reviewedAt: new Date(), reviewNote: args.reviewNote ?? null },
      });
      await logAudit({
        action: "ATTENDANCE_CORRECTION_REJECTED",
        entityType: "AttendanceCorrectionRequest",
        entityId: request.id,
        metadata: { sectionId: request.sectionId, date: request.date.toISOString().slice(0, 10), itemCount: request.items.length },
        userId: args.reviewerUserId,
        schoolId: args.schoolId,
        actorRole: args.reviewerRole ?? null,
      });
      return { ok: true, status: "REJECTED", alreadyFinal: false };
    }

    // APPROVE: re-check every item's original status against the CURRENT row.
    const currentRows = await tx.attendance.findMany({
      where: { schoolId: args.schoolId, sectionId: request.sectionId, date: request.date, studentId: { in: request.items.map((i) => i.studentId) } },
    });
    const currentByStudent = new Map(currentRows.map((r) => [r.studentId!, r.status as AttendanceStatusValue]));

    const conflictingStudentIds = request.items
      .filter((item) => currentByStudent.get(item.studentId) !== (item.originalStatus as AttendanceStatusValue))
      .map((item) => item.studentId);
    if (conflictingStudentIds.length > 0) {
      return { ok: false, code: "STATUS_CONFLICT", conflictingStudentIds };
    }

    const historyEntries = [];
    for (const item of request.items) {
      const row = currentRows.find((r) => r.studentId === item.studentId)!;
      await tx.attendance.update({ where: { id: row.id }, data: { status: item.requestedStatus as AttendanceStatusValue } });
      historyEntries.push({
        schoolId: args.schoolId,
        attendanceId: row.id,
        studentId: item.studentId,
        sectionId: request.sectionId,
        date: request.date,
        oldStatus: item.originalStatus as AttendanceStatusValue,
        newStatus: item.requestedStatus as AttendanceStatusValue,
        actorId: args.reviewerUserId,
        actorRole: args.reviewerRole ?? null,
        source: "CORRECTION_APPROVED" as const,
        correctionRequestId: request.id,
        reason: request.reason,
      });
    }
    await recordAttendanceHistory(tx, historyEntries);

    await tx.attendanceCorrectionRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", reviewedById: args.reviewerUserId, reviewedAt: new Date(), reviewNote: args.reviewNote ?? null },
    });

    await logAudit({
      action: "ATTENDANCE_CORRECTION_APPROVED",
      entityType: "AttendanceCorrectionRequest",
      entityId: request.id,
      metadata: { sectionId: request.sectionId, date: request.date.toISOString().slice(0, 10), itemCount: request.items.length },
      userId: args.reviewerUserId,
      schoolId: args.schoolId,
      actorRole: args.reviewerRole ?? null,
    });

    // Every item here changed status by construction (createCorrectionRequest
    // rejects NO_OP items at creation time) — notify the affected students and
    // their guardians. Bounded by this request's own item list, never a
    // whole-section fan-out, so this stays synchronous.
    const changedStudentIds = request.items.map((i) => i.studentId);
    const studentRecipients: RecipientRef[] = changedStudentIds.map((studentId) => ({ recipientType: "STUDENT", recipientId: studentId }));
    const guardianRecipients = await guardianRecipientsForStudents(changedStudentIds);
    await createNotificationsBounded(tx, {
      schoolId: args.schoolId,
      eventType: "ATTENDANCE_CORRECTED",
      entityType: "AttendanceCorrectionRequest",
      entityId: request.id,
      recipients: [...studentRecipients, ...guardianRecipients],
      metadata: { sectionId: request.sectionId, date: request.date.toISOString().slice(0, 10) },
    });

    return { ok: true, status: "APPROVED", alreadyFinal: false };
  });
}
