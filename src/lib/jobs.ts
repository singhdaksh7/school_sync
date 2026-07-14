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
import { hasPrismaErrorCode } from "@/lib/tenant";

// Batch thresholds — above these, work MUST go async to a job.
export const REPORT_CARD_SYNC_LIMIT = 40;
export const STUDENT_BULK_IMPORT_SYNC_LIMIT = 100;
// A single section's generation is bounded (one subject/teacher/slot-grid
// search, well under a second even at pilot scale — see
// smart-timetable-generator.ts). Two or more sections in one request must go
// through the durable job instead of one long-running HTTP request (PART 19).
export const SMART_TIMETABLE_SYNC_SECTION_LIMIT = 1;

// A claimed job's lease. If a worker dies mid-run, another worker may re-claim
// the job once the lease expires (crash recovery).
export const JOB_LEASE_MS = 2 * 60 * 1000;

// The processor renews the lease on this interval while a handler is still
// executing (see job-processor.ts's heartbeat loop) — deliberately well
// inside the lease window (1/4) so a couple of missed/slow heartbeats (a
// transient DB error, GC pause, etc.) never let the lease expire out from
// under a worker that is still legitimately processing.
export const JOB_HEARTBEAT_INTERVAL_MS = 30 * 1000;

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

// Multi-section Smart Timetable generation batch — see src/lib/smart-timetable-batch.ts.
// A single-section generation stays synchronous (SMART_TIMETABLE_SYNC_SECTION_LIMIT);
// this job type exists for the multi-section/whole-school case only.
export const smartTimetableGenerationPayloadSchema = z.object({
  schoolId: z.string().min(1),
  createdById: z.string().min(1),
  sections: z
    .array(
      z.object({
        classId: z.string().min(1),
        sectionId: z.string().min(1),
        completionMode: z.enum(["COMPLETE_REMAINING_ONLY", "REOPTIMIZE_UNLOCKED"]).optional(),
      })
    )
    .min(1),
  generationSeed: z.string().optional(),
});
export type SmartTimetableGenerationPayload = z.infer<typeof smartTimetableGenerationPayloadSchema>;

// Recurring maintenance job — see src/lib/file-retention.ts. Triggered by the
// internal maintenance endpoint/script (PART 21), never directly by a school user.
export const fileRetentionCleanupPayloadSchema = z.object({
  triggeredBy: z.enum(["MAINTENANCE_ENDPOINT", "CLI"]),
});
export type FileRetentionCleanupPayload = z.infer<typeof fileRetentionCleanupPayloadSchema>;

// Founder School Danger Zone: asynchronous, idempotent tenant-data purge —
// see src/lib/school-purge.ts (the destructive body) and
// src/lib/school-deletion.ts (schedule/cancel + the maintenance trigger that
// creates this job once a school's retention window elapses).
export const schoolDataPurgePayloadSchema = z.object({
  schoolId: z.string().min(1),
});
export type SchoolDataPurgePayload = z.infer<typeof schoolDataPurgePayloadSchema>;

export const JOB_PAYLOAD_SCHEMAS = {
  REPORT_CARD_BATCH_GENERATION: reportCardBatchPayloadSchema,
  STUDENT_BULK_IMPORT: studentBulkImportPayloadSchema,
  SMART_TIMETABLE_GENERATION: smartTimetableGenerationPayloadSchema,
  FILE_RETENTION_CLEANUP: fileRetentionCleanupPayloadSchema,
  SCHOOL_DATA_PURGE: schoolDataPurgePayloadSchema,
} satisfies Record<JobType, z.ZodTypeAny>;

/** Feature entitlement required to CREATE each job type (null = no catalog gate). */
export const JOB_TYPE_FEATURE: Record<JobType, FeatureFlagKeyValue | null> = {
  REPORT_CARD_BATCH_GENERATION: "REPORT_CARDS",
  STUDENT_BULK_IMPORT: null, // student management has no catalog feature key
  SMART_TIMETABLE_GENERATION: null, // timetable module has no catalog feature key (see feature-routes.ts)
  FILE_RETENTION_CLEANUP: null, // internal maintenance job, no catalog feature key
  SCHOOL_DATA_PURGE: null, // Founder platform-admin job, no catalog feature key
};

// ── Creation ─────────────────────────────────────────────────────────────────
/**
 * Phase 4 concurrency closure (PART 11): a plain "look up, then create if
 * absent" dedup check (job-dedup.ts's `findExistingEquivalentJob`) is a
 * classic TOCTOU race — two simultaneous identical requests can both see "no
 * active equivalent job" and both create one. The DB-level backstop is a
 * PARTIAL UNIQUE INDEX (see the
 * `20260709000000_job_dedup_active_unique_index` migration):
 *   CREATE UNIQUE INDEX ... ON "BackgroundJob" (schoolId, type, payloadFingerprint)
 *   WHERE status IN ('PENDING','RUNNING') AND payloadFingerprint IS NOT NULL
 * A COMPLETED/FAILED job is outside that partial index, so it never blocks a
 * later legitimate equivalent job — only two simultaneously-ACTIVE duplicates
 * are impossible. When the second concurrent create hits the unique
 * constraint (P2002), this function re-queries for the now-guaranteed-to-exist
 * active job and returns it instead of failing the request — the caller sees
 * a graceful "deduplicated" result either way, whether it was ITS OWN
 * findExistingEquivalentJob pre-check or this DB-level fallback that caught it.
 */
export async function createJob(input: {
  type: JobType;
  schoolId: string | null;
  createdById?: string | null;
  payload: unknown;
  totalItems: number;
  /** Stable fingerprint of the normalized payload — see src/lib/job-dedup.ts. Only set by job types that opt into duplicate-active-job protection. */
  payloadFingerprint?: string;
}): Promise<{ ok: true; job: BackgroundJob; deduplicated?: boolean } | { ok: false; error: string }> {
  const schema = JOB_PAYLOAD_SCHEMAS[input.type];
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) return { ok: false, error: "Invalid job payload" };

  try {
    const job = await prisma.backgroundJob.create({
      data: {
        type: input.type,
        schoolId: input.schoolId,
        createdById: input.createdById ?? null,
        payload: parsed.data as Prisma.InputJsonValue,
        totalItems: input.totalItems,
        payloadFingerprint: input.payloadFingerprint ?? null,
        status: "PENDING",
      },
    });
    return { ok: true, job };
  } catch (err) {
    if (input.payloadFingerprint && hasPrismaErrorCode(err, "P2002")) {
      const existing = await prisma.backgroundJob.findFirst({
        where: { schoolId: input.schoolId, type: input.type, payloadFingerprint: input.payloadFingerprint, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { ok: true, job: existing, deduplicated: true };
    }
    throw err;
  }
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

/**
 * Marks a job COMPLETED — but ONLY if `claimToken` still matches the row's
 * current claim (compare-and-swap, same pattern as claimNextJob/heartbeatJob).
 * Returns false (a safe no-op, never an overwrite) when the claim is stale —
 * e.g. the lease expired and a different worker already reclaimed the job.
 * Callers MUST check the return value rather than assuming success.
 */
export async function completeJob(jobId: string, claimToken: string, resultMetadata: Prisma.InputJsonValue): Promise<boolean> {
  const res = await prisma.backgroundJob.updateMany({
    where: { id: jobId, claimToken, status: "RUNNING" },
    data: { status: "COMPLETED", progress: 100, resultMetadata, completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
  });
  return res.count === 1;
}

/** Same stale-claim protection as {@link completeJob}, for the failure path. */
export async function failJob(jobId: string, claimToken: string, errorSummary: string): Promise<boolean> {
  const res = await prisma.backgroundJob.updateMany({
    where: { id: jobId, claimToken, status: "RUNNING" },
    data: { status: "FAILED", errorSummary: errorSummary.slice(0, 500), completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
  });
  return res.count === 1;
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
