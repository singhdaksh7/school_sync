/**
 * HTTP-independent job processor. Claims a job atomically, runs a background
 * heartbeat to keep its lease alive for the full duration of handler
 * execution, dispatches to the typed handler, updates progress, and marks
 * completion/failure. Runs from the standalone worker (scripts/worker.ts) or
 * the authenticated internal worker route — NEVER as fire-and-forget work
 * after an HTTP response.
 */

import { claimNextJob, completeJob, failJob, updateJobProgress, heartbeatJob, JOB_HEARTBEAT_INTERVAL_MS } from "@/lib/jobs";
import { getJobHandler } from "@/lib/job-handlers";
import type { Prisma } from "@/generated/prisma/client";

export type ProcessOutcome = { processed: boolean; jobId?: string; status?: "COMPLETED" | "FAILED" };

/**
 * Starts a guarded interval that periodically renews the job's lease
 * (src/lib/jobs.ts `heartbeatJob`) while its handler is still running.
 * This protects any single long silent step (e.g. one slow query with no
 * progress callback in between) — `updateJobProgress` already renews the
 * lease as a side effect, but that alone only helps once progress is
 * actually reported, which a handler may not do frequently or at all during
 * its first expensive step. One consistent renewal path: both progress
 * updates AND this heartbeat call the same `heartbeatJob`-equivalent
 * extension logic, they just fire on different triggers (event vs. timer).
 *
 * Guarded against overlap: a heartbeat tick is skipped (not queued) if the
 * previous tick's DB call hasn't finished yet, rather than letting two
 * concurrent renewal calls race each other.
 */
function startLeaseHeartbeat(jobId: string, claimToken: string) {
  let stopped = false;
  let inFlight = false;
  let lastKnownOwned = true;

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    heartbeatJob(jobId, claimToken)
      .then((renewed) => {
        if (!renewed && lastKnownOwned) {
          // Transitioned from owned → not-owned: the lease was lost (expired
          // and reclaimed by another worker, or the job was otherwise moved
          // out of RUNNING). Log once — completeJob/failJob's own
          // claim-token check is what actually prevents a stale overwrite;
          // this is purely an operational signal.
          console.error("[job-processor] heartbeat: lease no longer owned (job likely reclaimed)", { jobId });
        }
        lastKnownOwned = renewed;
      })
      .catch((err) => {
        // Transient DB error — log and let the NEXT tick retry. The handler
        // keeps running cautiously; only completeJob/failJob's atomic
        // claim-token check decides whether the final state write lands.
        console.error("[job-processor] heartbeat: transient error, will retry", {
          jobId,
          err: err instanceof Error ? err.message : err,
        });
      })
      .finally(() => {
        inFlight = false;
      });
  }, JOB_HEARTBEAT_INTERVAL_MS);

  // Never let this timer keep the Node process alive on its own.
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export async function processNextJob(): Promise<ProcessOutcome> {
  const job = await claimNextJob();
  if (!job || !job.claimToken) return { processed: false };
  const token = job.claimToken;

  const handler = getJobHandler(job.type);
  if (!handler) {
    await failJob(job.id, token, `Unknown job type: ${job.type}`);
    return { processed: true, jobId: job.id, status: "FAILED" };
  }

  const heartbeat = startLeaseHeartbeat(job.id, token);
  try {
    const result = await handler(job, {
      updateProgress: (processed, failed) =>
        updateJobProgress(job.id, token, {
          processedItems: processed,
          failedItems: failed,
          totalItems: job.totalItems,
        }),
    });
    const completed = await completeJob(job.id, token, result.resultMetadata as Prisma.InputJsonValue);
    if (!completed) {
      // The handler finished its work, but this worker's claim was already
      // stale by the time it tried to write completion — another worker may
      // have reclaimed and be re-running the same (idempotent) job. We do
      // NOT overwrite whatever state that other worker has since produced.
      console.error("[job-processor] completeJob no-op — claim token stale, another worker owns this job now", { jobId: job.id });
    }
    return { processed: true, jobId: job.id, status: "COMPLETED" };
  } catch (err) {
    console.error("[job-processor] job failed", { jobId: job.id, type: job.type });
    const failed = await failJob(job.id, token, err instanceof Error ? err.message : "Job failed");
    if (!failed) {
      console.error("[job-processor] failJob no-op — claim token stale, another worker owns this job now", { jobId: job.id });
    }
    return { processed: true, jobId: job.id, status: "FAILED" };
  } finally {
    // Always stop the heartbeat — success, handler failure, or (via the
    // implicit rethrow semantics of try/finally) any unexpected processor
    // failure above. No interval is ever left running after this function
    // returns.
    heartbeat.stop();
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
