/**
 * Standalone background-job worker.
 *
 * It does NOT import the app's `@/` module graph (which needs Next's runtime);
 * instead it drives the authenticated internal worker endpoint so the real
 * processor runs inside the app runtime where Prisma/storage are configured.
 *
 *   npm run worker:once   # drain the queue once, then exit (cron/scheduler)
 *   npm run worker        # continuous poll loop with graceful shutdown
 *
 * Env:
 *   JOB_WORKER_SECRET      (required)  shared secret for the internal endpoint
 *   WORKER_INTERNAL_URL    (optional)  default http://localhost:3000/api/internal/worker
 *   WORKER_POLL_MS         (optional)  default 5000
 *   WORKER_BATCH           (optional)  default 10
 */
import "dotenv/config";

const url = process.env.WORKER_INTERNAL_URL ?? "http://localhost:3000/api/internal/worker";
const secret = process.env.JOB_WORKER_SECRET;
const pollMs = Number(process.env.WORKER_POLL_MS ?? 5000);
const batch = Number(process.env.WORKER_BATCH ?? 10);
const once = process.argv.includes("--once");

async function runOnce(): Promise<number> {
  if (!secret) {
    console.error("[worker] JOB_WORKER_SECRET is not set — refusing to run");
    process.exit(1);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": secret },
    body: JSON.stringify({ max: batch }),
  });
  if (!res.ok) {
    console.error(`[worker] runner responded ${res.status}`);
    return 0;
  }
  const data = (await res.json()) as { processed?: number };
  return data.processed ?? 0;
}

async function main() {
  if (once) {
    // Drain fully, then exit.
    let total = 0;
    for (;;) {
      const n = await runOnce();
      total += n;
      if (n === 0) break;
    }
    console.log(`[worker] one-shot processed ${total} job(s)`);
    return;
  }

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(`[worker] polling ${url} every ${pollMs}ms`);
  while (!stopping) {
    try {
      const n = await runOnce();
      if (n > 0) console.log(`[worker] processed ${n} job(s)`);
    } catch (err) {
      console.error("[worker] poll error:", err instanceof Error ? err.message : err);
    }
    // Sequential await guarantees no overlapping local claims.
    await new Promise((r) => setTimeout(r, pollMs));
  }
  console.log("[worker] shutting down gracefully");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
