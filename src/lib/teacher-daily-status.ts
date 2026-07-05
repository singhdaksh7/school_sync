/**
 * School Operations Command Center — admin teacher daily status mutation
 * (PART 28/29). REUSES the existing `Attendance` model (type=TEACHER) — a
 * genuine direct persisted teacher-attendance model already exists
 * end-to-end (self-check-in, cutoff, auto-absent sweep — see
 * src/lib/teacher-attendance.ts), so no new model was introduced. The one
 * real gap closed here: there was previously no admin-driven bulk correction
 * path (the generic attendance route explicitly rejects admin-marked TEACHER
 * rows — see src/app/api/schools/[schoolId]/attendance/route.ts).
 *
 * Approved leave has operational precedence (documented product decision,
 * PART 29): a bulk update attempting to mark an approved-leave teacher
 * PRESENT or ABSENT for that date is REJECTED per-teacher (not silently
 * ignored) so the admin gets clear, actionable feedback instead of a
 * confusing no-op.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { DelegatedAuditMetadata } from "@/lib/operational-audit";

export interface TeacherStatusUpdateInput {
  teacherId: string;
  status: "PRESENT" | "ABSENT";
}

export interface TeacherStatusUpdateResult {
  teacherId: string;
  ok: boolean;
  reason?: "FOREIGN_TEACHER" | "ON_APPROVED_LEAVE" | "SELF_TEACHER_STATUS_MUTATION_FORBIDDEN";
}

const MAX_BATCH_SIZE = 500;

/**
 * `delegatedAudit`, when present (PART 17/23), means the caller reached this
 * mutation via effective Operations Head delegation, NOT the Owner/Admin
 * path. Two consequences: (1) `delegatedAudit.actorTeacherId` may never
 * appear as an update target — an effective head cannot use this privileged
 * path to change their OWN daily status (SELF_TEACHER_STATUS_MUTATION_FORBIDDEN),
 * and (2) the audit row records the delegation context. Owner/Admin calls
 * omit this argument entirely and are unaffected by either rule.
 */
export async function bulkSetTeacherDailyStatus(args: {
  schoolId: string;
  dateOnly: Date;
  updates: TeacherStatusUpdateInput[];
  markedById: string;
  actorRole?: string | null;
  delegatedAudit?: DelegatedAuditMetadata;
}): Promise<{ ok: true; results: TeacherStatusUpdateResult[] } | { ok: false; error: string }> {
  const { schoolId, dateOnly, updates, markedById, actorRole, delegatedAudit } = args;
  if (updates.length === 0) return { ok: false, error: "No updates provided" };
  if (updates.length > MAX_BATCH_SIZE) return { ok: false, error: `Batch too large (max ${MAX_BATCH_SIZE})` };

  const teacherIds = [...new Set(updates.map((u) => u.teacherId))];
  const [validTeachers, onLeaveRows] = await Promise.all([
    prisma.teacher.findMany({ where: { id: { in: teacherIds }, schoolId, isDeleted: false }, select: { id: true } }),
    prisma.leaveRequest.findMany({
      where: { schoolId, type: "TEACHER", status: "APPROVED", teacherId: { in: teacherIds }, fromDate: { lte: dateOnly }, toDate: { gte: dateOnly } },
      select: { teacherId: true },
    }),
  ]);
  const validTeacherIds = new Set(validTeachers.map((t) => t.id));
  const onLeaveIds = new Set(onLeaveRows.map((r) => r.teacherId).filter((id): id is string => Boolean(id)));

  const results: TeacherStatusUpdateResult[] = [];
  const applicable: TeacherStatusUpdateInput[] = [];
  for (const update of updates) {
    if (delegatedAudit && update.teacherId === delegatedAudit.actorTeacherId) {
      results.push({ teacherId: update.teacherId, ok: false, reason: "SELF_TEACHER_STATUS_MUTATION_FORBIDDEN" });
      continue;
    }
    if (!validTeacherIds.has(update.teacherId)) {
      results.push({ teacherId: update.teacherId, ok: false, reason: "FOREIGN_TEACHER" });
      continue;
    }
    if (onLeaveIds.has(update.teacherId)) {
      results.push({ teacherId: update.teacherId, ok: false, reason: "ON_APPROVED_LEAVE" });
      continue;
    }
    applicable.push(update);
    results.push({ teacherId: update.teacherId, ok: true });
  }

  if (applicable.length > 0) {
    await prisma.$transaction(
      applicable.map((u) =>
        prisma.attendance.upsert({
          where: { date_teacherId: { date: dateOnly, teacherId: u.teacherId } },
          create: { date: dateOnly, type: "TEACHER", status: u.status, teacherId: u.teacherId, schoolId, markedById },
          update: { status: u.status, markedById },
        })
      )
    );
  }

  // One summarized audit entry for the whole batch, not one row per teacher.
  await logAudit({
    action: "ATTENDANCE_MARKED",
    entityType: "Teacher",
    metadata: {
      scope: "BULK_TEACHER_DAILY_STATUS",
      date: dateOnly.toISOString().slice(0, 10),
      applied: applicable.length,
      rejected: results.length - applicable.length,
      teacherIds: applicable.map((u) => u.teacherId).slice(0, 100),
      ...(delegatedAudit ? { operational: delegatedAudit } : {}),
    },
    userId: markedById,
    schoolId,
    actorRole,
  });

  return { ok: true, results };
}
