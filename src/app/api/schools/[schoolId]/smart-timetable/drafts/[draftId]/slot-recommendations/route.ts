import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, teacherBelongsToSchool } from "@/lib/tenant";
import { draftBelongsToSchool, getDraft } from "@/lib/smart-timetable-drafts";
import { getCompatibleSlotsForAssignment } from "@/lib/smart-timetable-slots";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; draftId: string }> }) {
  const { schoolId, draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await draftBelongsToSchool(draftId, schoolId))) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const draft = await getDraft(draftId, schoolId);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get("teacherId");
  const subjectName = searchParams.get("subjectName");
  const allowConsecutive = searchParams.get("allowConsecutive") === "true";
  const diagnostic = searchParams.get("diagnostic") === "true";

  if (!teacherId || !subjectName) return NextResponse.json({ error: "teacherId and subjectName are required" }, { status: 400 });
  if (!(await teacherBelongsToSchool(teacherId, schoolId))) {
    return NextResponse.json({ error: "Teacher not found in this school" }, { status: 400 });
  }

  const result = await getCompatibleSlotsForAssignment({
    schoolId,
    sectionId: draft.sectionId,
    teacherId,
    subjectName,
    allowConsecutive,
    draftId,
    includeInvalid: diagnostic,
  });

  return NextResponse.json(result);
}
