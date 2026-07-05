import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool } from "@/lib/tenant";
import { draftBelongsToSchool } from "@/lib/smart-timetable-drafts";
import { computeQualityScore } from "@/lib/smart-timetable-quality";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const result = await computeQualityScore(draftId, schoolId);
  return NextResponse.json(result);
}
