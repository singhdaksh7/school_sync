import { prisma } from "@/lib/prisma";

export type AuditAction =
  | "STUDENT_CREATED" | "STUDENT_UPDATED" | "STUDENT_DELETED"
  | "TEACHER_CREATED" | "TEACHER_UPDATED" | "TEACHER_DELETED"
  | "TEACHER_ROLE_ASSIGNED" | "TEACHER_ROLE_UNASSIGNED"
  | "TEACHER_CUSTOM_ROLE_UPDATED" | "TEACHER_CUSTOM_ROLE_DELETED"
  | "MARKS_SUBMITTED"
  | "LEAVE_APPROVED" | "LEAVE_REJECTED"
  | "EARLY_LEAVE_APPROVED" | "EARLY_LEAVE_REJECTED"
  | "ARRANGEMENTS_AUTO_GENERATED"
  | "FEE_PAYMENT_RECORDED"
  | "FEE_STRUCTURE_CREATED" | "FEE_STRUCTURE_DELETED"
  | "STUDENT_TRANSFERRED"
  | "GUARDIAN_UPSERTED"
  | "ANNOUNCEMENT_CREATED" | "ANNOUNCEMENT_UPDATED" | "ANNOUNCEMENT_DELETED"
  | "HOLIDAY_CREATED" | "HOLIDAY_DELETED"
  | "HOMEWORK_CREATED" | "HOMEWORK_UPDATED" | "HOMEWORK_CANCELLED" | "HOMEWORK_REVIEWED"
  | "HOMEWORK_COMPLETION_UPDATED"
  | "NOTEBOOK_CHECK_UPDATED"
  | "EXAM_MILESTONE_CREATED" | "EXAM_MILESTONE_UPDATED" | "EXAM_MILESTONE_DISABLED"
  | "ATTENDANCE_MARKED"
  | "REPORT_CARD_GENERATED" | "REPORT_CARD_PUBLISHED" | "REPORT_CARD_DOWNLOADED"
  | "PAYMENT_PROOF_SUBMITTED" | "PAYMENT_PROOF_APPROVED" | "PAYMENT_PROOF_REJECTED"
  | "SCHOOL_STATUS_CHANGED"
  | "SUBSCRIPTION_UPDATED"
  | "PLAN_CREATED" | "PLAN_UPDATED"
  | "INVITE_CREATED" | "INVITE_RESENT" | "INVITE_CANCELLED" | "INVITE_ACCEPTED"
  | "LOGIN_SUCCESS" | "LOGIN_FAILED"
  | "PASSWORD_RESET_REQUESTED" | "PASSWORD_RESET_COMPLETED";

export async function logAudit({
  action,
  entityType,
  entityId,
  metadata,
  userId,
  schoolId,
  actorRole,
  ipAddress,
}: {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  userId: string;
  schoolId?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId: entityId ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        userId,
        schoolId: schoolId ?? null,
        actorRole: actorRole ?? null,
        ipAddress: ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}
