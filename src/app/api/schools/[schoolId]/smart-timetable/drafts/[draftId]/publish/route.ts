import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { draftBelongsToSchool } from "@/lib/smart-timetable-drafts";
import { publishDraft } from "@/lib/smart-timetable-publish";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function POST(_req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const denied = await enforceActorRateLimit({ schoolId, actorType: role ?? "USER", actorId: session.user.id }, "MUTATION");
  if (denied) return denied;
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const result = await publishDraft({ draftId, schoolId, publishedByUserId: session.user.id, actorRole: role });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code, issues: result.issues }, { status: 400 });
  return NextResponse.json(result);
}
