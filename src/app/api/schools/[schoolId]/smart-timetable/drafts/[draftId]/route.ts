import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool } from "@/lib/tenant";
import { getDraft } from "@/lib/smart-timetable-drafts";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const draft = await getDraft(draftId, schoolId);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  return NextResponse.json({ draft });
}
