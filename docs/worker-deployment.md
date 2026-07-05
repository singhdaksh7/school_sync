# Background Job Worker — Deployment Guide

The durable job system (`src/lib/jobs.ts`, `job-processor.ts`, `job-handlers.ts`)
is fully implemented, but **nothing runs it automatically**. A deploy platform
(Vercel or otherwise) does not run `scripts/worker.ts` for you — you must wire
one of the two patterns below.

**Is job execution currently automatically running in production? → REQUIRES WORKER CONFIGURATION.**

## Required environment

| Variable | Required | Purpose |
|---|---|---|
| `JOB_WORKER_SECRET` | Yes | Shared secret the worker sends as `x-worker-secret` to authenticate against `/api/internal/worker`. Must be a dedicated secret — never reuse `NEXTAUTH_SECRET`, a DB credential, or the Founder password. |
| `WORKER_INTERNAL_URL` | No (default `http://localhost:3000/api/internal/worker`) | The deployed app's internal worker endpoint. Set to the real production URL when the worker runs as a separate process from the web app. |
| `WORKER_POLL_MS` | No (default `5000`) | Poll interval for the continuous worker. |
| `WORKER_BATCH` | No (default `10`) | Max jobs claimed per poll/invocation. |

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

This repository does **not** ship a cron/scheduler config for any specific
platform — one was deliberately not added since no hosting platform's
scheduler integration has been selected/wired here. Configure your deploy
platform's own scheduled-invocation mechanism to run this command.

## Concurrency guidance

- **How many workers are safe to run concurrently?** Any number — the
  atomic compare-and-swap claim (`claimNextJob` in `src/lib/jobs.ts`) makes
  concurrent claims safe: exactly one worker wins each job, others simply
  move to the next candidate. Running 2+ workers only increases throughput,
  never causes double-processing.
- **Lease semantics:** a claimed job gets a 2-minute lease
  (`JOB_LEASE_MS`). The worker does not currently send heartbeats during
  processing (see `heartbeatJob` in jobs.ts, available but not wired into
  the processor loop) — a job handler that legitimately runs longer than
  2 minutes risks a second worker reclaiming it after the lease expires.
  Report-card/bulk-import handlers are chunked and update progress
  frequently in practice, but this is a known limitation to watch under
  pilot load (see risk register).
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
