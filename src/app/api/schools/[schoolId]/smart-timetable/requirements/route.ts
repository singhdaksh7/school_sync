import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool, canWriteSchool, classBelongsToSchool, sectionBelongsToSchool, sessionRole, teacherBelongsToSchool } from "@/lib/tenant";
import { getSubjectRequirements, setSubjectRequirements } from "@/lib/smart-timetable-drafts";
import { calculateWeeklyCapacity, validateSubjectRequirements } from "@/lib/timetable-capacity";
import { findApplicableSubject } from "@/lib/master-subjects";
import { prisma } from "@/lib/prisma";

interface RequirementBody {
  subjectId?: unknown;
  requiredPeriodsPerWeek?: unknown;
  minPeriodsPerDay?: unknown;
  maxPeriodsPerDay?: unknown;
  allowConsecutive?: unknown;
  preferredTeacherId?: unknown;
}

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
  const { classId, sectionId, requirements } = body as { classId: string; sectionId: string; requirements: RequirementBody[] };

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
    if (typeof r.subjectId !== "string" || !r.subjectId.trim()) {
      return NextResponse.json({ error: "Each requirement needs a subjectId" }, { status: 400 });
    }
    if (!Number.isFinite(r.requiredPeriodsPerWeek) || (r.requiredPeriodsPerWeek as number) < 0) {
      return NextResponse.json({ error: "Each requirement needs a non-negative requiredPeriodsPerWeek" }, { status: 400 });
    }
  }

  // Server-side enforcement: a subjectId must resolve to a real Master
  // Subject that actually belongs to this school/class/section (class-wide or
  // section-specific) — never trust the dropdown alone, since a caller could
  // submit an arbitrary, stale, cross-school, or cross-class/section id.
  const uniqueSubjectIds = [...new Set(requirements.map((r) => r.subjectId as string))];
  const resolvedEntries = await Promise.all(
    uniqueSubjectIds.map(async (id) => [id, await findApplicableSubject(id, schoolId, classId, sectionId)] as const)
  );
  const resolvedSubjects = new Map(resolvedEntries);
  for (const r of requirements) {
    if (!resolvedSubjects.get(r.subjectId as string)) {
      return NextResponse.json(
        { error: "One or more subjects are invalid, inactive, or not part of this class/section's Master Subjects" },
        { status: 422 }
      );
    }
  }

  const resolvedRequirements = requirements.map((r) => ({
    subjectId: r.subjectId as string,
    subjectName: resolvedSubjects.get(r.subjectId as string)!.name,
    requiredPeriodsPerWeek: r.requiredPeriodsPerWeek as number,
    minPeriodsPerDay: (r.minPeriodsPerDay as number | null | undefined) ?? null,
    maxPeriodsPerDay: (r.maxPeriodsPerDay as number | null | undefined) ?? null,
    allowConsecutive: Boolean(r.allowConsecutive),
    preferredTeacherId: (r.preferredTeacherId as string | null | undefined) ?? null,
  }));

  const saved = await setSubjectRequirements({ schoolId, classId, sectionId, requirements: resolvedRequirements });

  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timetableWorkingDays: true, periodsPerDay: true } });
  const capacity = calculateWeeklyCapacity(school);
  const validation = validateSubjectRequirements(capacity, saved);

  return NextResponse.json({ requirements: saved, capacity: validation });
}
