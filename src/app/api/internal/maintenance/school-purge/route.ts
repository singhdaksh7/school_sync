import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isJobWorkerConfigured } from "@/lib/jobs";
import { ensureDueSchoolPurgeJobs } from "@/lib/school-deletion";

/**
 * Internal, secret-authenticated maintenance trigger — mirrors
 * /api/internal/maintenance/file-retention exactly. Intended to be invoked
 * by a deployment scheduler (e.g. once daily); NEVER exposed to school
 * admins, Founders, or the public UI directly. Ensures exactly one active
 * SCHOOL_DATA_PURGE job per school whose retention window has elapsed (or
 * whose previous purge attempt failed) — a duplicate trigger never creates a
 * second purge job for the same school.
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

  const result = await ensureDueSchoolPurgeJobs();
  return NextResponse.json(result);
}
