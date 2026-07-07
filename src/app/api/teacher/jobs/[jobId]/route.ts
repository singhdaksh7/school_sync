import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { getJobForSchool } from "@/lib/jobs";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

// Teacher-scoped job status read — narrower than the generic Owner/Admin
// route (GET /api/schools/[schoolId]/jobs/[jobId], NextAuth + canAccessSchool
// only). Reuses the exact same getJobForSchool lookup (no second job engine,
// no change to claim/lease/heartbeat/dedup/completion/failure semantics) —
// only the authentication + authorization layer differs:
//   - canonical Teacher auth (getTeacherAuth: web session OR bearer JWT)
//   - restricted to job TYPES a Teacher can legitimately track (today: only
//     REPORT_CARD_BATCH_GENERATION — STUDENT_BULK_IMPORT,
//     SMART_TIMETABLE_GENERATION, and FILE_RETENTION_CLEANUP are Admin-only
//     workflows a Teacher never creates and must never read)
//   - restricted to a job this teacher actually created (payload.teacherId),
//     not merely any job in the school — prevents one Teacher polling
//     another Teacher's report-card generation job
export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await enforceActorRateLimit(
    { schoolId: teacherAuth.schoolId, actorType: "TEACHER", actorId: teacherAuth.teacherId },
    "JOB_STATUS"
  );
  if (denied) return denied;

  const job = await getJobForSchool(jobId, teacherAuth.schoolId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (job.type !== "REPORT_CARD_BATCH_GENERATION") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const payload = job.payload as { teacherId?: string } | null;
  if (!payload || payload.teacherId !== teacherAuth.teacherId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Never claimToken, raw payload, or payloadFingerprint — only the safe
  // progress view mobile needs, same fields the Admin route already exposes.
  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    failedItems: job.failedItems,
    errorSummary: job.errorSummary,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}
