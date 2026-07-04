import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, sectionBelongsToSchool, teacherBelongsToSchool } from "@/lib/tenant";
import { findFreeSlotsForTeacher } from "@/lib/timetable-recommendations";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  const teacherId = searchParams.get("teacherId");
  const periodsPerDay = Number(searchParams.get("periodsPerDay"));
  const daysPerWeek = Number(searchParams.get("daysPerWeek")) || 6;

  if (!sectionId || !teacherId || !Number.isFinite(periodsPerDay) || periodsPerDay < 1) {
    return NextResponse.json({ error: "sectionId, teacherId, and periodsPerDay are required" }, { status: 400 });
  }
  if (!(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
  }
  if (!(await teacherBelongsToSchool(teacherId, schoolId))) {
    return NextResponse.json({ error: "Teacher not found in this school" }, { status: 400 });
  }

  const freeSlots = await findFreeSlotsForTeacher({ schoolId, sectionId, teacherId, periodsPerDay, daysPerWeek });
  return NextResponse.json({ freeSlots });
}
