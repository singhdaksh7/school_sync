import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole, classBelongsToSchool, sectionBelongsToSchool } from "@/lib/tenant";
import { createJob, isJobWorkerConfigured, SMART_TIMETABLE_SYNC_SECTION_LIMIT } from "@/lib/jobs";
import { generateSectionsBatch, type BatchSectionInput } from "@/lib/smart-timetable-batch";
import type { CompletionMode } from "@/lib/smart-timetable-generator";

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
    const created = await createJob({
      type: "SMART_TIMETABLE_GENERATION",
      schoolId,
      createdById: session.user.id,
      payload: { schoolId, createdById: session.user.id, sections, generationSeed },
      totalItems: sections.length,
    });
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
    return NextResponse.json({ mode: "job", jobId: created.job.id, status: created.job.status, totalItems: sections.length }, { status: 202 });
  }

  const batchInput: BatchSectionInput[] = sections.map((s) => ({ classId: s.classId, sectionId: s.sectionId, completionMode: s.completionMode }));
  const { results } = await generateSectionsBatch({ schoolId, sections: batchInput, createdById: session.user.id, generationSeed });
  return NextResponse.json({ mode: "sync", results });
}
