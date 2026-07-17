import type { Prisma } from "@/generated/prisma/client";

export type AttendanceHistorySource = "DRAFT_MARK" | "SUBMISSION" | "CORRECTION_APPROVED" | "ADMIN_EMERGENCY" | "LEAVE_RECONCILIATION";
export type AttendanceStatusValue = "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";

export interface AttendanceHistoryEntryInput {
  schoolId: string;
  attendanceId: string;
  studentId: string;
  sectionId: string;
  date: Date;
  oldStatus: AttendanceStatusValue | null;
  newStatus: AttendanceStatusValue;
  actorId: string;
  actorRole?: string | null;
  source: AttendanceHistorySource;
  correctionRequestId?: string | null;
  reason?: string | null;
}

/**
 * Append-only insert — this is the ONLY place application code should ever
 * write to AttendanceHistory. Never call update()/delete() on this model from
 * a route: history rows must remain immutable (see AGENTS/feature spec).
 * Always call this WITHIN the same transaction as the Attendance row change
 * it documents, using the transaction client (`tx`) passed in.
 */
export async function recordAttendanceHistory(
  tx: Prisma.TransactionClient,
  entries: AttendanceHistoryEntryInput[]
): Promise<void> {
  if (entries.length === 0) return;
  await tx.attendanceHistory.createMany({
    data: entries.map((entry) => ({
      schoolId: entry.schoolId,
      attendanceId: entry.attendanceId,
      studentId: entry.studentId,
      sectionId: entry.sectionId,
      date: entry.date,
      oldStatus: entry.oldStatus,
      newStatus: entry.newStatus,
      actorId: entry.actorId,
      actorRole: entry.actorRole ?? null,
      source: entry.source,
      correctionRequestId: entry.correctionRequestId ?? null,
      reason: entry.reason ?? null,
    })),
  });
}
