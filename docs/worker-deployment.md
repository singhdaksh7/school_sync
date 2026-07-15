# Background Job Worker — Deployment Guide

The durable job system (`src/lib/jobs.ts`, `job-processor.ts`, `job-handlers.ts`)
is fully implemented, but **nothing runs it automatically**. A deploy platform
does not run `scripts/worker.ts` for you — you must wire one of the patterns
below for your target platform.

**Is job execution currently automatically running in production? → On
Vercel: yes, via the Cron configuration in Option C below. On any other
platform (ECS, a VM, etc.) without that cron wired: REQUIRES WORKER
CONFIGURATION (Option A or B).**

## Required environment

| Variable | Required | Purpose |
|---|---|---|
| `JOB_WORKER_SECRET` | Yes | Shared secret the worker sends as `x-worker-secret` to authenticate against `/api/internal/worker` and `/api/internal/maintenance/*`. Also gates `isJobWorkerConfigured()`, which every job-processing route (including the Vercel Cron routes below) checks before doing anything. Must be a dedicated secret — never reuse `NEXTAUTH_SECRET`, a DB credential, or the Founder password. |
| `CRON_SECRET` | Yes (Vercel only) | Vercel's own recognized name for authenticating scheduled Cron invocations — Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` to every path listed in `vercel.json`'s `crons`. Verified independently by `src/lib/cron-auth.ts`; never reuse `JOB_WORKER_SECRET`'s value for this even though both are "job auth" in spirit — they protect different transports (custom header vs. Vercel's own bearer convention) and rotating one must not require touching the other. |
| `WORKER_INTERNAL_URL` | No (default `http://localhost:3000/api/internal/worker`) | Only used by `scripts/worker.ts` (Option A/B, not the Vercel Cron path). Set to the real URL when the worker runs as a separate process from the web app. |
| `WORKER_POLL_MS` | No (default `5000`) | Poll interval for the continuous worker (Option A). |
| `WORKER_BATCH` | No (default `10`) | Max jobs claimed per poll/invocation (Option A/B). |

## Option A — Continuous worker process

```
npm run worker
```

Runs `scripts/worker.ts` in a poll loop: claim → process → sleep `WORKER_POLL_MS`
→ repeat, until `SIGINT`/`SIGTERM`. Suitable for a long-running container/VM
process (not a serverless function, which would be killed between polls).

**Graceful shutdown:** the loop checks a `stopping` flag on `SIGINT`/`SIGTERM`
and exits after the current poll completes — no job is interrupted mid-claim.

## Option B — Scheduler invoking a one-shot drain

```
npm run worker:once
```

Drains the entire queue (repeats `runOnce()` until it processes 0 jobs), then
exits. Intended for an external scheduler (cron, a platform's scheduled
functions, etc.) invoking it on a fixed interval — e.g. every 1–5 minutes,
depending on how quickly large batches need to start processing.

Prefer this on any platform other than Vercel — a long-running container/VM
process, or a scheduler that shells out to `npm run worker:once`.

## Option C — Vercel Cron (this repository's Vercel path)

`vercel.json`'s `crons` array invokes three GET routes on a schedule, each a
thin CRON_SECRET-authenticated wrapper around the exact same
claiming/idempotency logic Options A/B use — no duplicated business logic:

| Cron path | Schedule | Calls |
|---|---|---|
| `/api/internal/cron/worker` | every 5 minutes | `processNextJob` (job-processor.ts) in a bounded loop — up to 20 jobs or 50s wall-clock, whichever first |
| `/api/internal/cron/school-purge` | daily, 03:00 UTC | `ensureDueSchoolPurgeJobs()` (school-deletion.ts) — enqueues, never processes |
| `/api/internal/cron/file-retention` | daily, 04:00 UTC | `ensureFileRetentionCleanupJob()` (file-retention.ts) — enqueues, never processes |

Discovery (school-purge/file-retention) only enqueues; the worker cron's next
5-minute tick processes whatever was enqueued. Vercel's own cron auth
(`CRON_SECRET`, see the required-environment table above) gates all three;
each also independently re-checks `isJobWorkerConfigured()`
(`JOB_WORKER_SECRET`) before doing anything, so a misconfigured environment
fails closed (503) rather than silently skipping work.

**Overlap safety:** if a scheduled invocation is still running when the next
one fires (a slow queue drain overlapping the next 5-minute tick), both
requests reach the same atomic `claimNextJob` compare-and-swap
(`src/lib/jobs.ts`) — only one can ever win a given job's claim, so
overlapping cron ticks cannot double-process a job. This is the same
guarantee Options A/B already rely on for concurrent worker processes; no
additional run-level lock is layered on top because none is needed for
correctness (see `tests/cron-worker-routes.test.ts` for the regression proof).

**Function-limit bounding:** the worker cron route sets
`export const maxDuration = 60` and internally stops after 20 jobs or 50
seconds of wall-clock time, leaving headroom under the configured limit
regardless of plan. Raise `MAX_JOBS_PER_RUN`/`DEADLINE_MS` in
`src/app/api/internal/cron/worker/route.ts` only alongside a matching
`maxDuration` increase.

## Concurrency guidance

- **How many workers are safe to run concurrently?** Any number — the
  atomic compare-and-swap claim (`claimNextJob` in `src/lib/jobs.ts`) makes
  concurrent claims safe: exactly one worker wins each job, others simply
  move to the next candidate. Running 2+ workers only increases throughput,
  never causes double-processing.
- **Lease semantics:** a claimed job gets a 2-minute lease (`JOB_LEASE_MS`).
  `job-processor.ts`'s `startLeaseHeartbeat` renews it every 30 seconds
  (`JOB_HEARTBEAT_INTERVAL_MS`) for as long as the handler is still running,
  independently of whatever progress callbacks that handler makes — a slow
  first step with no progress reporting yet is still covered.
- **Crash recovery:** if a worker crashes mid-job, the job stays `RUNNING`
  with an unexpired lease until the lease time passes, then any worker
  (the same one restarted, or a different one) can reclaim it via the same
  compare-and-swap. No job is silently lost; at-least-once processing is
  the guarantee (handlers are written to be idempotent where practical —
  e.g. report-card generation upserts by `(studentId, examSchemeId)`).

## Health/readiness relation

`/api/health?check=readiness` reports `jobWorkerConfigured` (whether
`JOB_WORKER_SECRET` is set) but does **not** verify a worker process is
actually running/polling — it can only observe configuration, not liveness of
an external process. The job-creating routes (`teacher/report-cards/generate`,
`schools/[id]/students/bulk`) independently refuse (503) to create a job when
`JOB_WORKER_SECRET` is unset, so large workloads never queue invisible stuck
work even if readiness isn't checked before the request.
