import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { getJobForSchool, cancelPendingJob } from "@/lib/jobs";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; jobId: string }> }) {
  const { schoolId, jobId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "JOB_STATUS");
    if (denied) return denied;
  }

  // Tenant-scoped lookup: a job id from another school is not found here.
  const job = await getJobForSchool(jobId, schoolId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Never leak internal payloads/error stacks to school users — return a safe view.
  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    failedItems: job.failedItems,
    resultMetadata: job.resultMetadata,
    errorSummary: job.errorSummary,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ schoolId: string; jobId: string }> }) {
  const { schoolId, jobId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  // Only a not-yet-started job can be cancelled.
  const cancelled = await cancelPendingJob(jobId, schoolId);
  if (!cancelled) return NextResponse.json({ error: "Job cannot be cancelled" }, { status: 409 });
  return NextResponse.json({ success: true });
}
