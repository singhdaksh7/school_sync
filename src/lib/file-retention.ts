/**
 * File retention policy (PART 17-19). The server ALWAYS derives expiresAt —
 * never trusts a client-supplied value. Each function here returns the
 * `{ retentionPolicy, expiresAt }` pair to persist on the StoredFile row at
 * upload/association time.
 */

import type { FileRetentionPolicy } from "@/generated/prisma/client";
import {
  HOMEWORK_ATTACHMENT_RETENTION_DAYS,
  HOMEWORK_SUBMISSION_RETENTION_DAYS,
  STUDENT_IMPORT_SUCCESS_RETENTION_DAYS,
  STUDENT_IMPORT_FAILURE_RETENTION_DAYS,
} from "@/lib/cost-guard-policy";
import { prisma } from "@/lib/prisma";
import { createJob } from "@/lib/jobs";

export interface RetentionAssignment {
  retentionPolicy: FileRetentionPolicy;
  expiresAt: Date | null;
}

function daysFrom(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Homework teacher attachment: due date + 7 days. Recompute this whenever the due date changes (PART 19) — never after the file has already been deleted. */
export function homeworkAttachmentRetention(dueDate: Date): RetentionAssignment {
  return { retentionPolicy: "EXPIRING", expiresAt: daysFrom(dueDate, HOMEWORK_ATTACHMENT_RETENTION_DAYS) };
}

/** Homework submission attachment: due date + 30 days (review/scoring/complaint window). */
export function homeworkSubmissionRetention(dueDate: Date): RetentionAssignment {
  return { retentionPolicy: "EXPIRING", expiresAt: daysFrom(dueDate, HOMEWORK_SUBMISSION_RETENTION_DAYS) };
}

/** Student import source: terminal job completion + a short troubleshooting window (shorter on success, longer on failure). */
export function studentImportSourceRetention(jobStatus: "COMPLETED" | "FAILED" | "CANCELLED", completedAt: Date): RetentionAssignment {
  const days = jobStatus === "COMPLETED" ? STUDENT_IMPORT_SUCCESS_RETENTION_DAYS : STUDENT_IMPORT_FAILURE_RETENTION_DAYS;
  return { retentionPolicy: "EXPIRING", expiresAt: daysFrom(completedAt, days) };
}

/** SaaS payment proofs never auto-expire. */
export const PAYMENT_PROOF_RETENTION: RetentionAssignment = { retentionPolicy: "LONG_TERM", expiresAt: null };

/** Report-card assets, branding images: retained while referenced; never age-deleted. */
export const REFERENCE_MANAGED_RETENTION: RetentionAssignment = { retentionPolicy: "REFERENCE_MANAGED", expiresAt: null };

/**
 * Maintenance trigger contract (PART 21): ensures exactly one PENDING/RUNNING
 * FILE_RETENTION_CLEANUP job exists, creating one only if none is already
 * active. Safe to call as often as a deployment's scheduler likes (e.g. a
 * daily cron hitting the maintenance endpoint twice by mistake) — it never
 * creates a duplicate active cleanup job.
 */
export async function ensureFileRetentionCleanupJob(triggeredBy: "MAINTENANCE_ENDPOINT" | "CLI"): Promise<{ jobId: string; created: boolean }> {
  const existing = await prisma.backgroundJob.findFirst({
    where: { type: "FILE_RETENTION_CLEANUP", status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { jobId: existing.id, created: false };

  const created = await createJob({
    type: "FILE_RETENTION_CLEANUP",
    schoolId: null,
    createdById: null,
    payload: { triggeredBy },
    totalItems: 0,
  });
  if (!created.ok) throw new Error(created.error);
  return { jobId: created.job.id, created: true };
}
