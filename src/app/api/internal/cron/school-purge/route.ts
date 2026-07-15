import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { isJobWorkerConfigured } from "@/lib/jobs";
import { ensureDueSchoolPurgeJobs } from "@/lib/school-deletion";

/**
 * Vercel Cron entry point (daily) for scheduled tenant-data purge discovery —
 * mirrors /api/internal/maintenance/school-purge exactly, just GET +
 * CRON_SECRET instead of POST + x-worker-secret (see
 * src/app/api/internal/cron/worker/route.ts's header comment for why two
 * auth shapes exist). Calls the same ensureDueSchoolPurgeJobs(), which is
 * itself idempotent — a duplicate trigger on the same day never creates a
 * second SCHOOL_DATA_PURGE job for a school already covered by an
 * active one. Enqueuing only; the worker cron (this same schedule family)
 * processes the resulting job.
 */
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isJobWorkerConfigured()) {
    return NextResponse.json({ error: "Worker not configured" }, { status: 503 });
  }
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await ensureDueSchoolPurgeJobs();
  return NextResponse.json(result);
}
