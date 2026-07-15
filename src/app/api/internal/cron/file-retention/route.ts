import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { isJobWorkerConfigured } from "@/lib/jobs";
import { ensureFileRetentionCleanupJob } from "@/lib/file-retention";

/**
 * Vercel Cron entry point (daily) for file-retention cleanup discovery —
 * mirrors /api/internal/maintenance/file-retention, GET + CRON_SECRET
 * instead of POST + x-worker-secret (see
 * src/app/api/internal/cron/worker/route.ts's header comment). Idempotent:
 * a duplicate same-day trigger never creates a second active
 * FILE_RETENTION_CLEANUP job.
 */
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isJobWorkerConfigured()) {
    return NextResponse.json({ error: "Worker not configured" }, { status: 503 });
  }
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId, created } = await ensureFileRetentionCleanupJob("MAINTENANCE_ENDPOINT");
  return NextResponse.json({ jobId, created });
}
