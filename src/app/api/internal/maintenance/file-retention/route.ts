import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isJobWorkerConfigured } from "@/lib/jobs";
import { ensureFileRetentionCleanupJob } from "@/lib/file-retention";

/**
 * Internal, secret-authenticated maintenance trigger (PART 21). Intended to
 * be invoked by a deployment scheduler (e.g. once daily) — NEVER exposed to
 * school admins or the public UI. Ensures exactly one active
 * FILE_RETENTION_CLEANUP job exists; a duplicate trigger (e.g. two scheduler
 * firings on the same day) never creates a second cleanup job.
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

  const { jobId, created } = await ensureFileRetentionCleanupJob("MAINTENANCE_ENDPOINT");
  return NextResponse.json({ jobId, created });
}
