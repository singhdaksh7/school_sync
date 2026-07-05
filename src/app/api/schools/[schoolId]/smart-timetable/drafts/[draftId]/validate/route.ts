import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, sessionRole } from "@/lib/tenant";
import { draftBelongsToSchool, validateDraft } from "@/lib/smart-timetable-drafts";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function POST(_req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const denied = await enforceActorRateLimit({ schoolId, actorType: sessionRole(session.user) ?? "USER", actorId: session.user.id }, "EXPENSIVE_READ");
  if (denied) return denied;
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const result = await validateDraft(draftId, schoolId);
  return NextResponse.json(result);
}
