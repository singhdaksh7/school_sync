import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression coverage for the Vercel Cron wrapper routes
// (src/app/api/internal/cron/*) added because Vercel has no persistent
// ECS-style worker: Cron only sends GET + `Authorization: Bearer
// <CRON_SECRET>`, never the `x-worker-secret` header the pre-existing
// /api/internal/worker and /api/internal/maintenance/* routes expect. These
// wrappers must (1) authenticate independently via CRON_SECRET, (2) still
// gate on JOB_WORKER_SECRET/isJobWorkerConfigured like every other job route,
// (3) call the exact same underlying claiming/idempotency functions — no
// duplicated logic, and (4) bound their own execution for Vercel Function
// limits.

const ORIGINAL_ENV = { ...process.env };

function cronReq(path: string, bearer?: string) {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

beforeEach(() => {
  process.env.JOB_WORKER_SECRET = "test-only-worker-secret-do-not-use-in-prod";
  process.env.CRON_SECRET = "test-only-cron-secret-do-not-use-in-prod";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("GET /api/internal/cron/worker", () => {
  it("401s with no Authorization header (never reaches processNextJob)", async () => {
    const processNextJob = vi.fn();
    vi.doMock("@/lib/job-processor", () => ({ processNextJob }));
    const { GET } = await import("@/app/api/internal/cron/worker/route");

    const res = await GET(cronReq("/api/internal/cron/worker"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(processNextJob).not.toHaveBeenCalled();
  });

  it("401s with an incorrect bearer token", async () => {
    const processNextJob = vi.fn();
    vi.doMock("@/lib/job-processor", () => ({ processNextJob }));
    const { GET } = await import("@/app/api/internal/cron/worker/route");

    const res = await GET(cronReq("/api/internal/cron/worker", "definitely-wrong"));

    expect(res.status).toBe(401);
    expect(processNextJob).not.toHaveBeenCalled();
  });

  it("503s when JOB_WORKER_SECRET is unset, even with a correct CRON_SECRET bearer", async () => {
    delete process.env.JOB_WORKER_SECRET;
    const processNextJob = vi.fn();
    vi.doMock("@/lib/job-processor", () => ({ processNextJob }));
    const { GET } = await import("@/app/api/internal/cron/worker/route");

    const res = await GET(cronReq("/api/internal/cron/worker", "test-only-cron-secret-do-not-use-in-prod"));

    expect(res.status).toBe(503);
    expect(processNextJob).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated/manual requests but processes jobs for a correctly authenticated cron call (invitation delivery job)", async () => {
    // Simulates a single INVITE_EMAIL_DELIVERY job being claimed and completed.
    const processNextJob = vi
      .fn()
      .mockResolvedValueOnce({ processed: true, jobId: "job1", status: "COMPLETED" })
      .mockResolvedValueOnce({ processed: false });
    vi.doMock("@/lib/job-processor", () => ({ processNextJob }));
    const { GET } = await import("@/app/api/internal/cron/worker/route");

    const res = await GET(cronReq("/api/internal/cron/worker", "test-only-cron-secret-do-not-use-in-prod"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.processed).toBe(1);
    expect(processNextJob).toHaveBeenCalledTimes(2); // one real claim, one empty-queue check
  });

  it("stops at the bounded per-run job cap when the queue never empties (never an unbounded drain in one invocation)", async () => {
    const processNextJob = vi.fn().mockResolvedValue({ processed: true, jobId: "x", status: "COMPLETED" });
    vi.doMock("@/lib/job-processor", () => ({ processNextJob }));
    const { GET } = await import("@/app/api/internal/cron/worker/route");

    const res = await GET(cronReq("/api/internal/cron/worker", "test-only-cron-secret-do-not-use-in-prod"));
    const json = await res.json();

    expect(json.processed).toBe(20); // MAX_JOBS_PER_RUN
    expect(processNextJob).toHaveBeenCalledTimes(20);
  });

  it("stops early once the wall-clock deadline is reached, even under the per-run job cap", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const processNextJob = vi.fn().mockImplementation(async () => {
      now += 20_000; // each simulated claim burns 20s of wall-clock time
      return { processed: true, jobId: "x", status: "COMPLETED" };
    });
    vi.doMock("@/lib/job-processor", () => ({ processNextJob }));
    const { GET } = await import("@/app/api/internal/cron/worker/route");

    const res = await GET(cronReq("/api/internal/cron/worker", "test-only-cron-secret-do-not-use-in-prod"));
    const json = await res.json();

    // DEADLINE_MS is 50s — after 3 calls (60s elapsed) the loop must stop,
    // well short of the 20-job cap.
    expect(json.processed).toBeLessThan(20);
    expect(json.processed).toBeGreaterThan(0);
  });

  it("exports a maxDuration bounded within typical Vercel Function limits", async () => {
    vi.doMock("@/lib/job-processor", () => ({ processNextJob: vi.fn() }));
    const route = await import("@/app/api/internal/cron/worker/route");
    expect(route.maxDuration).toBeLessThanOrEqual(300);
    expect(route.maxDuration).toBeGreaterThan(0);
  });

  it("overlapping invocations never double-process the same job (atomic claim shared across both calls)", async () => {
    // Models the real claimNextJob compare-and-swap: a shared queue that only
    // ever yields each job to ONE caller, regardless of how many concurrent
    // route invocations are racing to drain it.
    const queue = ["jobA", "jobB", "jobC"];
    const claimedBy: string[] = [];
    const processNextJob = vi.fn(async () => {
      const jobId = queue.shift();
      if (!jobId) return { processed: false };
      claimedBy.push(jobId);
      return { processed: true, jobId, status: "COMPLETED" as const };
    });
    vi.doMock("@/lib/job-processor", () => ({ processNextJob }));
    const { GET } = await import("@/app/api/internal/cron/worker/route");

    const authed = () => cronReq("/api/internal/cron/worker", "test-only-cron-secret-do-not-use-in-prod");
    const [resA, resB] = await Promise.all([GET(authed()), GET(authed())]);
    const [jsonA, jsonB] = await Promise.all([resA.json(), resB.json()]);

    // Combined, the two overlapping invocations process each of the 3 queued
    // jobs exactly once — never twice, never lost.
    expect(jsonA.processed + jsonB.processed).toBe(3);
    expect(new Set(claimedBy).size).toBe(3);
  });
});

describe("GET /api/internal/cron/school-purge", () => {
  it("401s without a valid CRON_SECRET bearer", async () => {
    const ensureDueSchoolPurgeJobs = vi.fn();
    vi.doMock("@/lib/school-deletion", () => ({ ensureDueSchoolPurgeJobs }));
    const { GET } = await import("@/app/api/internal/cron/school-purge/route");

    const res = await GET(cronReq("/api/internal/cron/school-purge"));

    expect(res.status).toBe(401);
    expect(ensureDueSchoolPurgeJobs).not.toHaveBeenCalled();
  });

  it("calls ensureDueSchoolPurgeJobs (scheduled-purge discovery) and returns its result when authorized", async () => {
    const ensureDueSchoolPurgeJobs = vi.fn(async () => ({ schoolIds: ["school1"], created: 1, reused: 0 }));
    vi.doMock("@/lib/school-deletion", () => ({ ensureDueSchoolPurgeJobs }));
    const { GET } = await import("@/app/api/internal/cron/school-purge/route");

    const res = await GET(cronReq("/api/internal/cron/school-purge", "test-only-cron-secret-do-not-use-in-prod"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ schoolIds: ["school1"], created: 1, reused: 0 });
    expect(ensureDueSchoolPurgeJobs).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/internal/cron/file-retention", () => {
  it("401s without a valid CRON_SECRET bearer", async () => {
    const ensureFileRetentionCleanupJob = vi.fn();
    vi.doMock("@/lib/file-retention", () => ({ ensureFileRetentionCleanupJob }));
    const { GET } = await import("@/app/api/internal/cron/file-retention/route");

    const res = await GET(cronReq("/api/internal/cron/file-retention"));

    expect(res.status).toBe(401);
    expect(ensureFileRetentionCleanupJob).not.toHaveBeenCalled();
  });

  it("calls ensureFileRetentionCleanupJob with MAINTENANCE_ENDPOINT when authorized", async () => {
    const ensureFileRetentionCleanupJob = vi.fn(async () => ({ jobId: "job_test1", created: true }));
    vi.doMock("@/lib/file-retention", () => ({ ensureFileRetentionCleanupJob }));
    const { GET } = await import("@/app/api/internal/cron/file-retention/route");

    const res = await GET(cronReq("/api/internal/cron/file-retention", "test-only-cron-secret-do-not-use-in-prod"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ jobId: "job_test1", created: true });
    expect(ensureFileRetentionCleanupJob).toHaveBeenCalledWith("MAINTENANCE_ENDPOINT");
  });
});
