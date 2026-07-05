import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, canWriteSchool, classBelongsToSchool, sectionBelongsToSchool, sessionRole, teacherBelongsToSchool } from "@/lib/tenant";
import { getSubjectRequirements, setSubjectRequirements, type SubjectRequirementInput } from "@/lib/smart-timetable-drafts";
import { calculateWeeklyCapacity, validateSubjectRequirements } from "@/lib/timetable-capacity";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
  if (!(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
  }

  const [requirements, school] = await Promise.all([
    getSubjectRequirements(sectionId),
    prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timetableWorkingDays: true, periodsPerDay: true } }),
  ]);

  const capacity = calculateWeeklyCapacity(school);
  const validation = validateSubjectRequirements(capacity, requirements);

  return NextResponse.json({ requirements, capacity: validation });
}

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { classId, sectionId, requirements } = body as { classId: string; sectionId: string; requirements: SubjectRequirementInput[] };

  if (!classId || !sectionId || !Array.isArray(requirements)) {
    return NextResponse.json({ error: "classId, sectionId, and requirements are required" }, { status: 400 });
  }
  if (!(await classBelongsToSchool(classId, schoolId)) || !(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Class or section not found in this school" }, { status: 400 });
  }
  const preferredTeacherIds = requirements.map((r) => r.preferredTeacherId).filter((id): id is string => Boolean(id));
  for (const teacherId of preferredTeacherIds) {
    if (!(await teacherBelongsToSchool(teacherId, schoolId))) {
      return NextResponse.json({ error: "One or more preferred teachers are not in this school" }, { status: 400 });
    }
  }
  for (const r of requirements) {
    if (!r.subjectName?.trim() || !Number.isFinite(r.requiredPeriodsPerWeek) || r.requiredPeriodsPerWeek < 0) {
      return NextResponse.json({ error: "Each requirement needs a subjectName and a non-negative requiredPeriodsPerWeek" }, { status: 400 });
    }
  }

  const saved = await setSubjectRequirements({ schoolId, classId, sectionId, requirements });

  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timetableWorkingDays: true, periodsPerDay: true } });
  const capacity = calculateWeeklyCapacity(school);
  const validation = validateSubjectRequirements(capacity, saved);

  return NextResponse.json({ requirements: saved, capacity: validation });
}
