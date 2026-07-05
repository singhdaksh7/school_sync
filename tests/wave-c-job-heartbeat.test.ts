import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Stateful in-memory `BackgroundJob` mock so claim-token transitions can be
 * tested realistically (claim → heartbeat → reclaim → stale-complete-attempt,
 * etc.) without a live Postgres connection.
 */
type FakeJob = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  claimToken: string | null;
  leaseExpiresAt: Date | null;
  claimedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  processedItems: number;
  failedItems: number;
  progress: number;
  resultMetadata: unknown;
  errorSummary: string | null;
  attempts: number;
  type: string;
  payload: unknown;
  totalItems: number;
  schoolId: string | null;
};

let jobs: FakeJob[] = [];
let idCounter = 0;

function matchesWhere(job: FakeJob, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      const or = value as Record<string, unknown>[];
      if (!or.some((clause) => matchesWhere(job, clause))) return false;
      continue;
    }
    if (value && typeof value === "object" && "lt" in (value as object)) {
      const field = job[key as keyof FakeJob] as Date | null;
      if (!field || !(field < (value as { lt: Date }).lt)) return false;
      continue;
    }
    if (job[key as keyof FakeJob] !== value) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    backgroundJob: {
      create: vi.fn(async ({ data }: { data: Partial<FakeJob> }) => {
        const job: FakeJob = {
          id: `job-${++idCounter}`,
          status: data.status ?? "PENDING",
          claimToken: null,
          leaseExpiresAt: null,
          claimedAt: null,
          startedAt: null,
          completedAt: null,
          processedItems: 0,
          failedItems: 0,
          progress: 0,
          resultMetadata: null,
          errorSummary: null,
          attempts: 0,
          type: data.type as string,
          payload: data.payload,
          totalItems: data.totalItems ?? 0,
          schoolId: data.schoolId ?? null,
        };
        jobs.push(job);
        return job;
      }),
      findFirst: vi.fn(async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const match = jobs.find((j) => matchesWhere(j, where));
        if (!match) return null;
        if (!select) return match;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) out[key] = match[key as keyof FakeJob];
        return out;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeJob> & { attempts?: { increment: number } } }) => {
        let count = 0;
        for (const job of jobs) {
          if (!matchesWhere(job, where)) continue;
          const patch = { ...data } as Record<string, unknown>;
          if (patch.attempts && typeof patch.attempts === "object" && "increment" in (patch.attempts as object)) {
            job.attempts += (patch.attempts as { increment: number }).increment;
            delete patch.attempts;
          }
          Object.assign(job, patch);
          count++;
        }
        return { count };
      }),
    },
  },
}));

beforeEach(() => {
  jobs = [];
  idCounter = 0;
  // The mocked updateMany's call history otherwise accumulates across every
  // test in this file (the vi.mock factory only runs once) — the
  // heartbeat-lifecycle tests count calls, so stale history from an earlier
  // test would corrupt the count.
  vi.clearAllMocks();
});

// ── heartbeatJob / completeJob / failJob claim-token authority ──────────────
describe("job lease heartbeat — claim-token authority (src/lib/jobs.ts)", () => {
  it("a matching claim token successfully extends the lease", async () => {
    const { createJob, claimNextJob, heartbeatJob } = await import("@/lib/jobs");
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });
    const claimed = await claimNextJob();
    expect(claimed?.claimToken).toBeTruthy();

    const before = claimed!.leaseExpiresAt;
    const ok = await heartbeatJob(claimed!.id, claimed!.claimToken!, new Date(Date.now() + 60_000));
    expect(ok).toBe(true);
    const after = jobs.find((j) => j.id === claimed!.id)!.leaseExpiresAt!;
    expect(after.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("a stale (old/wrong) claim token fails to heartbeat", async () => {
    const { createJob, claimNextJob, heartbeatJob } = await import("@/lib/jobs");
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });
    const claimed = await claimNextJob();
    const ok = await heartbeatJob(claimed!.id, "not-the-real-token");
    expect(ok).toBe(false);
  });

  it("a COMPLETED job cannot be heartbeated", async () => {
    const { createJob, claimNextJob, heartbeatJob, completeJob } = await import("@/lib/jobs");
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });
    const claimed = await claimNextJob();
    await completeJob(claimed!.id, claimed!.claimToken!, {});
    const ok = await heartbeatJob(claimed!.id, claimed!.claimToken!);
    expect(ok).toBe(false);
  });

  it("a FAILED job cannot be heartbeated", async () => {
    const { createJob, claimNextJob, heartbeatJob, failJob } = await import("@/lib/jobs");
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });
    const claimed = await claimNextJob();
    await failJob(claimed!.id, claimed!.claimToken!, "boom");
    const ok = await heartbeatJob(claimed!.id, claimed!.claimToken!);
    expect(ok).toBe(false);
  });

  it("lease extension moves leaseExpiresAt strictly forward", async () => {
    const { createJob, claimNextJob, heartbeatJob, JOB_LEASE_MS } = await import("@/lib/jobs");
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });
    const claimed = await claimNextJob();
    const now = new Date(Date.now() + 90_000); // simulate 90s later, still within the original 120s lease
    await heartbeatJob(claimed!.id, claimed!.claimToken!, now);
    const updated = jobs.find((j) => j.id === claimed!.id)!;
    expect(updated.leaseExpiresAt!.getTime()).toBe(now.getTime() + JOB_LEASE_MS);
  });

  it("a stale worker cannot COMPLETE a job that another worker has since reclaimed", async () => {
    const { createJob, claimNextJob, completeJob } = await import("@/lib/jobs");
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });
    const firstClaim = await claimNextJob();
    const staleToken = firstClaim!.claimToken!;

    // Simulate the lease expiring and a second worker reclaiming it.
    jobs.find((j) => j.id === firstClaim!.id)!.leaseExpiresAt = new Date(Date.now() - 1000);
    const secondClaim = await claimNextJob();
    expect(secondClaim!.claimToken).not.toBe(staleToken);

    // The first (stale) worker finally finishes and tries to complete under its old token.
    const staleCompleted = await completeJob(firstClaim!.id, staleToken, { result: "stale" });
    expect(staleCompleted).toBe(false);

    // The job is untouched by the stale write — still RUNNING under the second worker's claim.
    const current = jobs.find((j) => j.id === firstClaim!.id)!;
    expect(current.status).toBe("RUNNING");
    expect(current.claimToken).toBe(secondClaim!.claimToken);
  });

  it("a stale worker cannot FAIL a job that another worker has since reclaimed", async () => {
    const { createJob, claimNextJob, failJob } = await import("@/lib/jobs");
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });
    const firstClaim = await claimNextJob();
    const staleToken = firstClaim!.claimToken!;

    jobs.find((j) => j.id === firstClaim!.id)!.leaseExpiresAt = new Date(Date.now() - 1000);
    const secondClaim = await claimNextJob();

    const staleFailed = await failJob(firstClaim!.id, staleToken, "stale failure");
    expect(staleFailed).toBe(false);

    const current = jobs.find((j) => j.id === firstClaim!.id)!;
    expect(current.status).toBe("RUNNING");
    expect(current.claimToken).toBe(secondClaim!.claimToken);
  });
});

// ── job-processor.ts heartbeat lifecycle (fake timers) ───────────────────────
// `heartbeatJob` runs for real against the in-memory prisma mock above (we
// want its actual claim-token logic exercised, not a stub) — so heartbeat
// activity is observed through the mocked `updateMany`'s call shape instead
// of spying on the function directly. A heartbeat-only update is uniquely
// identifiable: it's the ONLY call site that patches `leaseExpiresAt` alone
// (claim/progress/complete/fail always touch other fields too).
function countHeartbeatOnlyCalls(updateManyMock: ReturnType<typeof vi.fn>): number {
  return updateManyMock.mock.calls.filter(([arg]: [{ data: Record<string, unknown> }]) => {
    const keys = Object.keys(arg.data);
    return keys.length === 1 && keys[0] === "leaseExpiresAt";
  }).length;
}

describe("job processor — heartbeat lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // job-processor.ts resolves its `getJobHandler` import binding at module
    // evaluation time — without resetting the module registry, a second
    // test's vi.doMock("@/lib/job-handlers", ...) would never be seen by an
    // already-evaluated (cached) job-processor module from an earlier test.
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/lib/job-handlers");
  });

  it("starts heartbeating during a long-running handler and stops after completion", async () => {
    const { createJob } = await import("@/lib/jobs");
    const { prisma } = await import("@/lib/prisma");
    const updateManyMock = (prisma as unknown as { backgroundJob: { updateMany: ReturnType<typeof vi.fn> } }).backgroundJob.updateMany;
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });

    let resolveHandler!: () => void;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });
    vi.doMock("@/lib/job-handlers", () => ({
      getJobHandler: () => async () => {
        await handlerPromise;
        return { processedItems: 1, failedItems: 0, resultMetadata: {} };
      },
    }));
    const { processNextJob } = await import("@/lib/job-processor");

    const processing = processNextJob();

    // Advance past two heartbeat intervals (30s each) while the handler is
    // still "running" — proves the heartbeat fires DURING a silent window
    // with no progress callback at all.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(countHeartbeatOnlyCalls(updateManyMock)).toBe(2);

    resolveHandler();
    const outcome = await processing;
    expect(outcome.status).toBe("COMPLETED");

    const callsAtCompletion = countHeartbeatOnlyCalls(updateManyMock);
    // Advance well past another interval — no further heartbeat calls after completion.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(countHeartbeatOnlyCalls(updateManyMock)).toBe(callsAtCompletion);
  });

  it("stops heartbeating after the handler throws", async () => {
    const { createJob } = await import("@/lib/jobs");
    const { prisma } = await import("@/lib/prisma");
    const updateManyMock = (prisma as unknown as { backgroundJob: { updateMany: ReturnType<typeof vi.fn> } }).backgroundJob.updateMany;
    await createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 1 }, totalItems: 1 });

    let rejectHandler!: (err: Error) => void;
    const handlerPromise = new Promise<never>((_, reject) => {
      rejectHandler = reject;
    });
    vi.doMock("@/lib/job-handlers", () => ({
      getJobHandler: () => async () => {
        await handlerPromise;
      },
    }));
    const { processNextJob } = await import("@/lib/job-processor");

    const processing = processNextJob();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(countHeartbeatOnlyCalls(updateManyMock)).toBe(1);

    rejectHandler(new Error("handler exploded"));
    const outcome = await processing;
    expect(outcome.status).toBe("FAILED");

    const callsAtFailure = countHeartbeatOnlyCalls(updateManyMock);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(countHeartbeatOnlyCalls(updateManyMock)).toBe(callsAtFailure);
  });
});
