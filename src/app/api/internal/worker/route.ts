import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processJobs } from "@/lib/job-processor";
import { isJobWorkerConfigured } from "@/lib/jobs";

/**
 * Internal, secret-authenticated job runner. Intended to be invoked by a
 * trusted scheduler/cron or the standalone worker poller (scripts/worker.ts) —
 * NEVER exposed to school admins or the public UI. It authenticates with a
 * dedicated JOB_WORKER_SECRET (not NEXTAUTH_SECRET / Founder / DB creds).
 *
 * The heavy lifting lives in the processor (src/lib/job-processor.ts); this
 * route is only an authenticated invocation surface.
 */
function authorized(req: Request): boolean {
  const secret = process.env.JOB_WORKER_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-worker-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isJobWorkerConfigured()) {
    return NextResponse.json({ error: "Worker not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let max = 10;
  try {
    const body = await req.json();
    if (typeof body?.max === "number" && body.max > 0) max = Math.min(body.max, 50);
  } catch {
    // no body → default
  }

  const result = await processJobs(max);
  return NextResponse.json(result);
}
