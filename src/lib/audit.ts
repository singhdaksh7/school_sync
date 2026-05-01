import { prisma } from "@/lib/prisma";

export type AuditAction =
  | "STUDENT_CREATED" | "STUDENT_UPDATED" | "STUDENT_DELETED"
  | "TEACHER_CREATED" | "TEACHER_DELETED"
  | "MARKS_SUBMITTED"
  | "LEAVE_APPROVED" | "LEAVE_REJECTED"
  | "FEE_PAYMENT_RECORDED"
  | "STUDENT_TRANSFERRED"
  | "ANNOUNCEMENT_CREATED" | "ANNOUNCEMENT_DELETED"
  | "HOLIDAY_CREATED" | "HOLIDAY_DELETED";

export async function logAudit({
  action,
  entityType,
  entityId,
  metadata,
  userId,
  schoolId,
}: {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  userId: string;
  schoolId: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId: entityId ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        userId,
        schoolId,
      },
    });
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}
