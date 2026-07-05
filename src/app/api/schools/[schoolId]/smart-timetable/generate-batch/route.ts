import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole, classBelongsToSchool, sectionBelongsToSchool } from "@/lib/tenant";
import { createJob, isJobWorkerConfigured, SMART_TIMETABLE_SYNC_SECTION_LIMIT } from "@/lib/jobs";
import { generateSectionsBatch, type BatchSectionInput } from "@/lib/smart-timetable-batch";
import type { CompletionMode } from "@/lib/smart-timetable-generator";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { findExistingEquivalentJob } from "@/lib/job-dedup";

type SectionRequest = { classId: string; sectionId: string; completionMode?: CompletionMode };

/**
 * Multi-section Smart Timetable generation (PART 18/19). At or below
 * SMART_TIMETABLE_SYNC_SECTION_LIMIT sections this runs synchronously
 * (bounded, same guarantee as the single-draft /generate route). Above the
 * limit it enqueues a durable SMART_TIMETABLE_GENERATION job and returns 202 —
 * never processes a large whole-school generation inside one HTTP request.
 */
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const denied = await enforceActorRateLimit({ schoolId, actorType: role ?? "USER", actorId: session.user.id }, "JOB_CREATE");
  if (denied) return denied;

  const body = await req.json();
  const { sections, generationSeed } = body as { sections: SectionRequest[]; generationSeed?: string };
  if (!Array.isArray(sections) || sections.length === 0) {
    return NextResponse.json({ error: "sections is required and must be non-empty" }, { status: 400 });
  }

  for (const s of sections) {
    if (!s.classId || !s.sectionId) return NextResponse.json({ error: "Each section requires classId and sectionId" }, { status: 400 });
    if (!(await classBelongsToSchool(s.classId, schoolId)) || !(await sectionBelongsToSchool(s.sectionId, schoolId))) {
      return NextResponse.json({ error: `Class/section ${s.sectionId} not found in this school` }, { status: 400 });
    }
  }

  if (sections.length > SMART_TIMETABLE_SYNC_SECTION_LIMIT) {
    if (!isJobWorkerConfigured()) {
      return NextResponse.json(
        { error: "Multi-section timetable generation is temporarily unavailable. Please generate one section at a time." },
        { status: 503 }
      );
    }
    const payload = { schoolId, createdById: session.user.id, sections, generationSeed };
    const { fingerprint, existing } = await findExistingEquivalentJob(schoolId, "SMART_TIMETABLE_GENERATION", payload);
    if (existing) {
      return NextResponse.json({ mode: "job", jobId: existing.id, status: existing.status, totalItems: existing.totalItems, deduplicated: true }, { status: 202 });
    }
    const created = await createJob({
      type: "SMART_TIMETABLE_GENERATION",
      schoolId,
      createdById: session.user.id,
      payload,
      totalItems: sections.length,
      payloadFingerprint: fingerprint,
    });
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
    // `created.deduplicated` means a concurrent identical request won the
    // create race between our own pre-check above and this call — report the
    // WINNING job's actual stored totalItems, not this request's count.
    return NextResponse.json(
      { mode: "job", jobId: created.job.id, status: created.job.status, totalItems: created.job.totalItems, deduplicated: created.deduplicated ?? false },
      { status: 202 }
    );
  }

  const batchInput: BatchSectionInput[] = sections.map((s) => ({ classId: s.classId, sectionId: s.sectionId, completionMode: s.completionMode }));
  const { results } = await generateSectionsBatch({ schoolId, sections: batchInput, createdById: session.user.id, generationSeed });
  return NextResponse.json({ mode: "sync", results });
}
