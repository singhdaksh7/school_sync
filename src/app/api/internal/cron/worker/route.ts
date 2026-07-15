import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { isJobWorkerConfigured } from "@/lib/jobs";
import { processNextJob } from "@/lib/job-processor";

/**
 * Vercel Cron entry point for draining the BackgroundJob queue (the
 * INVITE_EMAIL_DELIVERY job created by src/lib/school-onboarding.ts, plus
 * every other job type — see job-handlers.ts). Vercel Cron only supports GET
 * and cannot send the `x-worker-secret` header /api/internal/worker expects,
 * so this is a thin, separately-authenticated (CRON_SECRET, see
 * src/lib/cron-auth.ts) wrapper that calls the SAME processNextJob used by
 * that route and scripts/worker.ts — no duplicated claiming/idempotency
 * logic, just a different transport/auth for the platform that invokes it.
 *
 * Bounded for Vercel Function limits: stops after MAX_JOBS_PER_RUN jobs OR
 * once DEADLINE_MS of wall-clock time has elapsed, whichever comes first —
 * never a single invocation that tries to drain an unbounded queue. A
 * schedule of every few minutes (see vercel.json) picks up anything left
 * over on the next run.
 *
 * Overlap-safe by construction: claimNextJob's compare-and-swap (jobs.ts)
 * means two overlapping invocations of this route (a slow run still
 * finishing when the next scheduled tick fires) can never claim the same
 * job — the loser of the race simply sees 0 claimable candidates and exits
 * quickly. No separate run-level lock is needed for correctness.
 */
const MAX_JOBS_PER_RUN = 20;
const DEADLINE_MS = 50_000; // stay well under this route's maxDuration below

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isJobWorkerConfigured()) {
    return NextResponse.json({ error: "Worker not configured" }, { status: 503 });
  }
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let processed = 0;
  for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
    if (Date.now() - startedAt >= DEADLINE_MS) break;
    const outcome = await processNextJob();
    if (!outcome.processed) break;
    processed += 1;
  }

  return NextResponse.json({ processed, elapsedMs: Date.now() - startedAt });
}
