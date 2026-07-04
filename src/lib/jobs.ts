/**
 * Durable background-job service. Jobs are persisted rows (see BackgroundJob),
 * claimed ATOMICALLY via a compare-and-swap `updateMany`, and processed by a
 * separate worker (src/lib/job-processor.ts + scripts/worker.ts) — never via a
 * fire-and-forget `void processJob()` after an HTTP response.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { BackgroundJob, JobType, JobStatus, Prisma } from "@/generated/prisma/client";
import type { FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

// Batch thresholds — above these, work MUST go async to a job.
export const REPORT_CARD_SYNC_LIMIT = 40;
export const STUDENT_BULK_IMPORT_SYNC_LIMIT = 100;

// A claimed job's lease. If a worker dies mid-run, another worker may re-claim
// the job once the lease expires (crash recovery).
export const JOB_LEASE_MS = 2 * 60 * 1000;

// ── Payload schemas (never trust a DB Json blob without re-validation) ────────
export const reportCardBatchPayloadSchema = z.object({
  schoolId: z.string().min(1),
  teacherId: z.string().min(1),
  sectionId: z.string().min(1),
  examSchemeId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1),
  classTeacherRemark: z.string().nullable().optional(),
});
export type ReportCardBatchPayload = z.infer<typeof reportCardBatchPayloadSchema>;

export const studentBulkImportPayloadSchema = z.object({
  schoolId: z.string().min(1),
  createdById: z.string().min(1),
  // Rows live in a private managed object (not in the job row) to keep job rows small.
  storedFileId: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
});
export type StudentBulkImportPayload = z.infer<typeof studentBulkImportPayloadSchema>;

export const JOB_PAYLOAD_SCHEMAS = {
  REPORT_CARD_BATCH_GENERATION: reportCardBatchPayloadSchema,
  STUDENT_BULK_IMPORT: studentBulkImportPayloadSchema,
} satisfies Record<JobType, z.ZodTypeAny>;

/** Feature entitlement required to CREATE each job type (null = no catalog gate). */
export const JOB_TYPE_FEATURE: Record<JobType, FeatureFlagKeyValue | null> = {
  REPORT_CARD_BATCH_GENERATION: "REPORT_CARDS",
  STUDENT_BULK_IMPORT: null, // student management has no catalog feature key
};

// ── Creation ─────────────────────────────────────────────────────────────────
export async function createJob(input: {
  type: JobType;
  schoolId: string | null;
  createdById?: string | null;
  payload: unknown;
  totalItems: number;
}): Promise<{ ok: true; job: BackgroundJob } | { ok: false; error: string }> {
  const schema = JOB_PAYLOAD_SCHEMAS[input.type];
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) return { ok: false, error: "Invalid job payload" };

  const job = await prisma.backgroundJob.create({
    data: {
      type: input.type,
      schoolId: input.schoolId,
      createdById: input.createdById ?? null,
      payload: parsed.data as Prisma.InputJsonValue,
      totalItems: input.totalItems,
      status: "PENDING",
    },
  });
  return { ok: true, job };
}

// ── Reads (tenant-scoped by the caller) ──────────────────────────────────────
export function getJobForSchool(jobId: string, schoolId: string) {
  return prisma.backgroundJob.findFirst({ where: { id: jobId, schoolId } });
}

export function listJobsForSchool(schoolId: string, opts: { skip: number; take: number; type?: JobType }) {
  const where = { schoolId, ...(opts.type ? { type: opts.type } : {}) };
  return prisma.$transaction([
    prisma.backgroundJob.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
      select: {
        id: true, type: true, status: true, progress: true, totalItems: true,
        processedItems: true, failedItems: true, errorSummary: true,
        createdAt: true, startedAt: true, completedAt: true,
      },
    }),
    prisma.backgroundJob.count({ where }),
  ]);
}

// ── Atomic claim + lease ─────────────────────────────────────────────────────
/**
 * Claims the next runnable job (PENDING, or RUNNING with an expired lease) using
 * a conditional `updateMany`: two workers racing the same candidate → exactly
 * one gets `count === 1`; the other gets 0 and retries the next candidate.
 */
export async function claimNextJob(now: Date = new Date()): Promise<BackgroundJob | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await prisma.backgroundJob.findFirst({
      where: {
        OR: [
          { status: "PENDING" },
          { status: "RUNNING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
    });
    if (!candidate) return null;

    const token = randomUUID();
    const claim = await prisma.backgroundJob.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        ...(candidate.status === "RUNNING" ? { leaseExpiresAt: { lt: now } } : {}),
      },
      data: {
        status: "RUNNING",
        claimToken: token,
        claimedAt: now,
        startedAt: now,
        leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    if (claim.count === 1) {
      return prisma.backgroundJob.findFirst({ where: { id: candidate.id, claimToken: token } });
    }
    // Lost the race — try the next candidate.
  }
  return null;
}

/** Extends a claimed job's lease (worker heartbeat). No-op if the token is stale. */
export async function heartbeatJob(jobId: string, claimToken: string, now: Date = new Date()): Promise<boolean> {
  const res = await prisma.backgroundJob.updateMany({
    where: { id: jobId, claimToken, status: "RUNNING" },
    data: { leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS) },
  });
  return res.count === 1;
}

export async function updateJobProgress(
  jobId: string,
  claimToken: string,
  progress: { processedItems: number; failedItems: number; totalItems?: number }
): Promise<void> {
  const total = progress.totalItems;
  const pct = total && total > 0 ? Math.min(100, Math.round((progress.processedItems / total) * 100)) : 0;
  await prisma.backgroundJob.updateMany({
    where: { id: jobId, claimToken, status: "RUNNING" },
    data: {
      processedItems: progress.processedItems,
      failedItems: progress.failedItems,
      progress: pct,
      leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS),
    },
  });
}

export async function completeJob(jobId: string, claimToken: string, resultMetadata: Prisma.InputJsonValue): Promise<void> {
  await prisma.backgroundJob.updateMany({
    where: { id: jobId, claimToken, status: "RUNNING" },
    data: { status: "COMPLETED", progress: 100, resultMetadata, completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
  });
}

export async function failJob(jobId: string, claimToken: string, errorSummary: string): Promise<void> {
  await prisma.backgroundJob.updateMany({
    where: { id: jobId, claimToken, status: "RUNNING" },
    data: { status: "FAILED", errorSummary: errorSummary.slice(0, 500), completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
  });
}

/** Cancels a job that has not started. Returns false if it is already RUNNING/done. */
export async function cancelPendingJob(jobId: string, schoolId: string): Promise<boolean> {
  const res = await prisma.backgroundJob.updateMany({
    where: { id: jobId, schoolId, status: "PENDING" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  return res.count === 1;
}

// ── Worker configuration (readiness) ─────────────────────────────────────────
/** True when an internal worker secret is configured (worker can authenticate). */
export function isJobWorkerConfigured(): boolean {
  return Boolean(process.env.JOB_WORKER_SECRET);
}

export type { JobType, JobStatus };
