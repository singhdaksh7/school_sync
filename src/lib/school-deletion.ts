/**
 * Founder School Danger Zone: schedule / cancel / restore a school's
 * tenant-data deletion. The actual destructive purge is a separate,
 * asynchronous, idempotent BackgroundJob (SCHOOL_DATA_PURGE — see
 * src/lib/school-purge.ts + src/lib/job-handlers.ts). Nothing in this file
 * ever deletes tenant data directly.
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createJob } from "@/lib/jobs";
import { computeDeletionScheduledFor } from "@/lib/school-deletion-config";
import type { School, SchoolStatus } from "@/generated/prisma/client";

const RESTORABLE_STATUS_FALLBACK: SchoolStatus = "ACTIVE";

export type DeletionActionError =
  | { ok: false; code: "NOT_FOUND"; error: string }
  | { ok: false; code: "REAUTH_FAILED"; error: string }
  | { ok: false; code: "CONFIRMATION_MISMATCH"; error: string }
  | { ok: false; code: "INVALID_STATE"; error: string };

/** Re-verifies the Founder's password fresh on every call — no session-side "recently authenticated" flag exists in this codebase, so this IS the re-auth mechanism for both schedule and cancel (see ticket §6 "Recent-auth/re-auth requirement"). */
async function verifyFounderPassword(founderId: string, password: string): Promise<boolean> {
  const founder = await prisma.user.findUnique({ where: { id: founderId }, select: { password: true } });
  if (!founder) return false;
  return bcrypt.compare(password, founder.password);
}

/** Read-only impact preview shown before the Founder confirms scheduling deletion — aggregate counts only, no row contents. */
export async function getSchoolDeletionImpact(schoolId: string) {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, slug: true, status: true } });
  if (!school) return null;

  const [students, guardians, teachers, admins, classes, homework, examResults, feePayments, invites, storedFiles, backgroundJobs] =
    await Promise.all([
      prisma.student.count({ where: { schoolId } }),
      prisma.guardian.count({ where: { schoolId } }),
      prisma.teacher.count({ where: { schoolId } }),
      prisma.user.count({ where: { schoolId } }),
      prisma.class.count({ where: { schoolId } }),
      prisma.homework.count({ where: { schoolId } }),
      prisma.examResult.count({ where: { student: { schoolId } } }),
      prisma.feePayment.count({ where: { schoolId } }),
      prisma.schoolInvite.count({ where: { schoolId } }),
      prisma.storedFile.count({ where: { schoolId, deletedAt: null } }),
      prisma.backgroundJob.count({ where: { schoolId, status: { in: ["PENDING", "RUNNING"] } } }),
    ]);

  return {
    school,
    counts: { students, guardians, teachers, staffMemberships: admins, classes, homework, examResults, feePayments, invites, storedFiles, activeBackgroundJobs: backgroundJobs },
  };
}

export async function scheduleSchoolDeletion(input: {
  schoolId: string;
  founderId: string;
  password: string;
  confirmedNameOrSlug: string;
}): Promise<{ ok: true; school: School; scheduledFor: Date } | DeletionActionError> {
  const school = await prisma.school.findUnique({ where: { id: input.schoolId } });
  if (!school) return { ok: false, code: "NOT_FOUND", error: "School not found" };

  if (!(await verifyFounderPassword(input.founderId, input.password))) {
    return { ok: false, code: "REAUTH_FAILED", error: "Password confirmation failed" };
  }

  const confirmed = input.confirmedNameOrSlug.trim();
  if (confirmed !== school.name && confirmed !== school.slug) {
    return { ok: false, code: "CONFIRMATION_MISMATCH", error: "Typed name/slug does not match this school" };
  }

  if (["PENDING_DELETION", "DELETING", "DELETION_FAILED", "DELETED"].includes(school.status)) {
    return { ok: false, code: "INVALID_STATE", error: `School is already in ${school.status} state` };
  }

  const now = new Date();
  const scheduledFor = computeDeletionScheduledFor(now);

  const [updated] = await prisma.$transaction([
    prisma.school.update({
      where: { id: school.id },
      data: {
        status: "PENDING_DELETION",
        preDeletionStatus: school.status,
        deletionRequestedAt: now,
        deletionRequestedById: input.founderId,
        deletionScheduledFor: scheduledFor,
        deletionCancelledAt: null,
        deletionRetryCount: 0,
        deletionLastError: null,
      },
    }),
    // Immediately revoke this school's active mobile/API sessions — normal
    // access is blocked the instant deletion is scheduled, not only once the
    // purge job actually starts (school-access.ts's BLOCKING_STATUSES
    // already covers cookie/JWT-session-based web access via the status
    // check itself; AuthSession covers the separate revocable-token layer).
    prisma.authSession.updateMany({
      where: { schoolId: school.id, revokedAt: null },
      data: { revokedAt: now, revokeReason: "school_pending_deletion" },
    }),
    prisma.schoolDeletionAudit.create({
      data: {
        schoolId: school.id,
        actorId: input.founderId,
        action: "SCHEDULED",
        status: "PENDING_DELETION",
        counts: (await getSchoolDeletionImpact(school.id))?.counts ?? {},
      },
    }),
  ]);

  return { ok: true, school: updated, scheduledFor };
}

export async function cancelSchoolDeletion(input: {
  schoolId: string;
  founderId: string;
  password: string;
}): Promise<{ ok: true; school: School } | DeletionActionError> {
  const school = await prisma.school.findUnique({ where: { id: input.schoolId } });
  if (!school) return { ok: false, code: "NOT_FOUND", error: "School not found" };

  if (!(await verifyFounderPassword(input.founderId, input.password))) {
    return { ok: false, code: "REAUTH_FAILED", error: "Password confirmation failed" };
  }

  // Concurrency guard against a race with the purge job's own claim: only a
  // school still in PENDING_DELETION (never DELETING/DELETION_FAILED/DELETED)
  // may be restored. Compare-and-swap via a conditional updateMany, same
  // pattern as claimNextJob — count===0 means the purge already moved past
  // the restorable window.
  const now = new Date();
  const restored = await prisma.school.updateMany({
    where: { id: school.id, status: "PENDING_DELETION" },
    data: {
      status: school.preDeletionStatus ?? RESTORABLE_STATUS_FALLBACK,
      preDeletionStatus: null,
      deletionRequestedAt: null,
      deletionRequestedById: null,
      deletionScheduledFor: null,
      deletionCancelledAt: now,
      deletionRetryCount: 0,
      deletionLastError: null,
    },
  });

  if (restored.count === 0) {
    return { ok: false, code: "INVALID_STATE", error: "Deletion is no longer cancellable (purge already in progress or completed)" };
  }

  await prisma.schoolDeletionAudit.create({
    data: { schoolId: school.id, actorId: input.founderId, action: "CANCELLED", status: "RESTORED" },
  });

  const updated = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
  return { ok: true, school: updated };
}

/**
 * Maintenance-trigger contract (mirrors ensureFileRetentionCleanupJob):
 * finds every school whose retention window has elapsed and ensures exactly
 * one active SCHOOL_DATA_PURGE job exists per school — safe to call as often
 * as a scheduler likes.
 */
export async function ensureDueSchoolPurgeJobs(): Promise<{ schoolIds: string[]; created: number; reused: number }> {
  const due = await prisma.school.findMany({
    where: {
      OR: [
        { status: "PENDING_DELETION", deletionScheduledFor: { lte: new Date() } },
        // Already past due by definition — automatic retry for a purge that
        // failed partway through (see SCHOOL_DATA_PURGE handler).
        { status: "DELETION_FAILED" },
      ],
    },
    select: { id: true },
  });

  let created = 0;
  let reused = 0;
  for (const { id: schoolId } of due) {
    const existing = await prisma.backgroundJob.findFirst({
      where: { schoolId, type: "SCHOOL_DATA_PURGE", status: { in: ["PENDING", "RUNNING"] } },
    });
    if (existing) {
      reused += 1;
      continue;
    }
    const result = await createJob({
      type: "SCHOOL_DATA_PURGE",
      schoolId,
      createdById: null,
      payload: { schoolId },
      totalItems: 0,
    });
    if (result.ok && !result.deduplicated) created += 1;
    else reused += 1;
  }

  return { schoolIds: due.map((s) => s.id), created, reused };
}
