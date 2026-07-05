import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { draftBelongsToSchool, setSlotLocked } from "@/lib/smart-timetable-drafts";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const { dayOfWeek, period, locked } = (await req.json()) as { dayOfWeek: number; period: number; locked: boolean };
  if (!Number.isFinite(dayOfWeek) || !Number.isFinite(period) || typeof locked !== "boolean") {
    return NextResponse.json({ error: "dayOfWeek, period, and locked are required" }, { status: 400 });
  }

  const result = await setSlotLocked(draftId, dayOfWeek, period, locked);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
