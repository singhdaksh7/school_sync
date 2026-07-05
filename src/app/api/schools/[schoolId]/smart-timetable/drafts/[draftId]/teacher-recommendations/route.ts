import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, sessionRole } from "@/lib/tenant";
import { draftBelongsToSchool, getDraft } from "@/lib/smart-timetable-drafts";
import { recommendTeachers } from "@/lib/smart-timetable-recommendations";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const denied = await enforceActorRateLimit({ schoolId, actorType: sessionRole(session.user) ?? "USER", actorId: session.user.id }, "EXPENSIVE_READ");
  if (denied) return denied;
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const draft = await getDraft(draftId, schoolId);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const subjectName = searchParams.get("subjectName");
  if (!subjectName) return NextResponse.json({ error: "subjectName is required" }, { status: 400 });
  const requiredPeriods = Number(searchParams.get("requiredPeriods") ?? "1");
  const allowConsecutive = searchParams.get("allowConsecutive") === "true";

  const recommendations = await recommendTeachers({
    schoolId,
    classId: draft.classId,
    sectionId: draft.sectionId,
    subjectName,
    requiredPeriods: Number.isFinite(requiredPeriods) && requiredPeriods > 0 ? requiredPeriods : 1,
    allowConsecutive,
    draftId,
  });

  return NextResponse.json({ recommendations });
}
