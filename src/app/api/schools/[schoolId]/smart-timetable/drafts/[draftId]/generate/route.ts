import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { draftBelongsToSchool, getDraft } from "@/lib/smart-timetable-drafts";
import { generateDraft, type CompletionMode } from "@/lib/smart-timetable-generator";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

/** Single-section auto-generate/complete — bounded and synchronous (SMART_TIMETABLE_SYNC_SECTION_LIMIT = 1). Multi-section batches use /smart-timetable/generate-batch instead. */
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const denied = await enforceActorRateLimit({ schoolId, actorType: role ?? "USER", actorId: session.user.id }, "JOB_CREATE");
  if (denied) return denied;
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const draft = await getDraft(draftId, schoolId);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const completionMode = (body.completionMode as CompletionMode | undefined) ?? "COMPLETE_REMAINING_ONLY";
  if (completionMode !== "COMPLETE_REMAINING_ONLY" && completionMode !== "REOPTIMIZE_UNLOCKED") {
    return NextResponse.json({ error: "Invalid completionMode" }, { status: 400 });
  }

  const result = await generateDraft({
    schoolId,
    classId: draft.classId,
    sectionId: draft.sectionId,
    draftId,
    completionMode,
    createdById: session.user.id,
  });

  return NextResponse.json(result);
}
