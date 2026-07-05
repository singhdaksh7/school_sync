import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole, teacherBelongsToSchool } from "@/lib/tenant";
import { draftBelongsToSchool, getDraft, upsertDraftSlot, removeDraftSlot } from "@/lib/smart-timetable-drafts";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const draft = await getDraft(draftId, schoolId);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const body = await req.json();
  const { dayOfWeek, period, subjectName, teacherId, locked } = body as {
    dayOfWeek: number;
    period: number;
    subjectName: string | null;
    teacherId: string | null;
    locked?: boolean;
  };

  if (!Number.isFinite(dayOfWeek) || !Number.isFinite(period)) {
    return NextResponse.json({ error: "dayOfWeek and period are required" }, { status: 400 });
  }
  if (teacherId && !(await teacherBelongsToSchool(teacherId, schoolId))) {
    return NextResponse.json({ error: "Teacher not found in this school" }, { status: 400 });
  }

  const result = await upsertDraftSlot({
    draftId,
    schoolId,
    sectionId: draft.sectionId,
    dayOfWeek,
    period,
    subjectName: subjectName ?? null,
    teacherId: teacherId ?? null,
    locked,
  });

  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code, violations: result.violations }, { status: 400 });
  return NextResponse.json({ slot: result.slot });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const dayOfWeek = Number(searchParams.get("dayOfWeek"));
  const period = Number(searchParams.get("period"));
  if (!Number.isFinite(dayOfWeek) || !Number.isFinite(period)) {
    return NextResponse.json({ error: "dayOfWeek and period query params are required" }, { status: 400 });
  }

  const result = await removeDraftSlot(draftId, dayOfWeek, period);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
