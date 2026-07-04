/**
 * HTTP-independent job processor. Claims a job atomically, dispatches to the
 * typed handler, updates progress, and marks completion/failure. Runs from the
 * standalone worker (scripts/worker.ts) or the authenticated internal worker
 * route — NEVER as fire-and-forget work after an HTTP response.
 */

import { claimNextJob, completeJob, failJob, updateJobProgress } from "@/lib/jobs";
import { getJobHandler } from "@/lib/job-handlers";
import type { Prisma } from "@/generated/prisma/client";

export type ProcessOutcome = { processed: boolean; jobId?: string; status?: "COMPLETED" | "FAILED" };

export async function processNextJob(): Promise<ProcessOutcome> {
  const job = await claimNextJob();
  if (!job || !job.claimToken) return { processed: false };
  const token = job.claimToken;

  const handler = getJobHandler(job.type);
  if (!handler) {
    await failJob(job.id, token, `Unknown job type: ${job.type}`);
    return { processed: true, jobId: job.id, status: "FAILED" };
  }

  try {
    const result = await handler(job, {
      updateProgress: (processed, failed) =>
        updateJobProgress(job.id, token, {
          processedItems: processed,
          failedItems: failed,
          totalItems: job.totalItems,
        }),
    });
    await completeJob(job.id, token, result.resultMetadata as Prisma.InputJsonValue);
    return { processed: true, jobId: job.id, status: "COMPLETED" };
  } catch (err) {
    console.error("[job-processor] job failed", { jobId: job.id, type: job.type });
    await failJob(job.id, token, err instanceof Error ? err.message : "Job failed");
    return { processed: true, jobId: job.id, status: "FAILED" };
  }
}

/** Processes up to `max` jobs, stopping when the queue is drained. */
export async function processJobs(max = 10): Promise<{ processed: number }> {
  let processed = 0;
  for (let i = 0; i < max; i++) {
    const outcome = await processNextJob();
    if (!outcome.processed) break;
    processed += 1;
  }
  return { processed };
}
