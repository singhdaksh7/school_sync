import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canAccessSchool, canWriteSchool, classBelongsToSchool, hasPrismaErrorCode, sectionBelongsToSchool, sessionRole } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { getApplicableSubjects } from "@/lib/master-subjects";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId");
  const sectionId = searchParams.get("sectionId");
  const raw = searchParams.get("raw") === "1";
  const applicable = searchParams.get("applicable") === "1";
  if (!classId) return NextResponse.json({ error: "classId is required" }, { status: 400 });
  if (!(await classBelongsToSchool(classId, schoolId))) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  // applicable=1 (used by Smart Timetable's Weekly Period Requirements) returns
  // the full union of class-wide + section-specific Master Subjects for this
  // section, deduplicated by name — the complete set of subjects an admin may
  // pick from for this class/section, as opposed to the exclusive fallback
  // used by other integration consumers below.
  if (applicable) {
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    if (!(await sectionBelongsToSchool(sectionId, schoolId))) {
      return NextResponse.json({ error: "Section not found in this school" }, { status: 404 });
    }
    const subjects = await getApplicableSubjects(schoolId, classId, sectionId);
    return NextResponse.json(subjects);
  }

  // raw=1 (used by the Subject Master admin UI) returns exactly the rows stored
  // at this classId/sectionId scope, with no fallback — needed so the admin can
  // still see and edit the class-wide list even when a section override exists.
  if (raw) {
    const subjects = await prisma.subject.findMany({
      where: { classId, sectionId: sectionId ?? null },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(subjects);
  }

  // Exclusive scoping (used by integration consumers): if this section has its
  // own subjects, those are used as-is (class-wide subjects are not merged in).
  // Otherwise fall back to the class-wide list.
  if (sectionId) {
    const sectionSubjects = await prisma.subject.findMany({
      where: { classId, sectionId },
      orderBy: { name: "asc" },
    });
    if (sectionSubjects.length > 0) return NextResponse.json(sectionSubjects);
  }

  const classWideSubjects = await prisma.subject.findMany({
    where: { classId, sectionId: null },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(classWideSubjects);
}

const createSchema = z.object({
  classId: z.string().min(1),
  sectionId: z.string().min(1).optional(),
  name: z.string().min(1).max(100),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    if (!(await classBelongsToSchool(data.classId, schoolId))) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }
    if (data.sectionId) {
      const section = await prisma.section.findFirst({
        where: { id: data.sectionId, classId: data.classId, class: { schoolId } },
        select: { id: true },
      });
      if (!section) return NextResponse.json({ error: "Section not found in this class" }, { status: 404 });
    }

    const subject = await prisma.subject.create({
      data: {
        schoolId,
        classId: data.classId,
        sectionId: data.sectionId ?? null,
        name: data.name.trim(),
      },
    });

    await logAudit({
      action: "SUBJECT_CREATED",
      entityType: "Subject",
      entityId: subject.id,
      metadata: { name: subject.name, classId: subject.classId, sectionId: subject.sectionId },
      userId: session.user.id,
      schoolId,
    });

    return NextResponse.json(subject, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: "This subject already exists for this class/section" }, { status: 400 });
    console.error("Create subject error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
