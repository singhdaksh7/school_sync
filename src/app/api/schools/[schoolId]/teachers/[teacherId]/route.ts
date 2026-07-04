import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canAccessSchool, sectionBelongsToSchool } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  subject: z.string().optional(),
  mentorSectionId: z.string().optional().nullable(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string; teacherId: string }> }) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = schema.parse(body);
    const existing = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (data.mentorSectionId && !(await sectionBelongsToSchool(data.mentorSectionId, schoolId))) {
      return NextResponse.json({ error: "Mentor section not found in this school" }, { status: 400 });
    }

    // If assigning a new mentor section, clear any previous teacher's assignment for that section
    if (data.mentorSectionId) {
      await prisma.teacher.updateMany({
        where: { schoolId, mentorSectionId: data.mentorSectionId, id: { not: teacherId } },
        data: { mentorSectionId: null },
      });
    }

    await prisma.teacher.updateMany({
      where: { id: teacherId, schoolId },
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        subject: data.subject || null,
        mentorSectionId: data.mentorSectionId ?? null,
      },
    });
    const teacher = await prisma.teacher.findFirst({
      where: { id: teacherId, schoolId },
      include: {
        mentorSection: { include: { class: { select: { name: true } } } },
      },
    });
    return NextResponse.json(teacher);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; teacherId: string }> }) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId, isDeleted: false },
    include: {
      mentorSection: { include: { class: { select: { name: true } } } },
      timetableSlots: { include: { section: { include: { class: { select: { name: true } } } } } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Snapshot what this teacher was actively handling before we clear it from
  // the live timetable/mentor assignment — TimetableSlot has no date field
  // (it's the standing weekly schedule, not a dated log) so nulling teacherId
  // is how "removed from active timetable" works here. The snapshot preserves
  // "classes/sections handled" for the Deleted Teachers History view even
  // though the live relation is gone.
  const sectionsHandled = [
    ...new Map(
      existing.timetableSlots.map((s) => [s.sectionId, `${s.section.class.name}-${s.section.name}`])
    ).values(),
  ];
  const classesHandled = [...new Set(existing.timetableSlots.map((s) => s.section.class.name))];
  const mentorSectionName = existing.mentorSection
    ? `${existing.mentorSection.class.name}-${existing.mentorSection.name}`
    : null;

  // Soft delete: the row stays in place so all historical relations (homework,
  // attendance, timetable, exams, report cards) remain intact. Free up the
  // mentor section and active timetable slots so the school can reassign them.
  await prisma.$transaction([
    prisma.teacher.update({
      where: { id: teacherId },
      data: { isDeleted: true, deletedAt: new Date(), deletedById: session.user.id, mentorSectionId: null },
    }),
    prisma.timetableSlot.updateMany({
      where: { teacherId, schoolId },
      data: { teacherId: null },
    }),
  ]);

  await logAudit({
    action: "TEACHER_SOFT_DELETED",
    entityType: "Teacher",
    entityId: teacherId,
    metadata: { mentorSectionName, classesHandled, sectionsHandled },
    userId: session.user.id,
    schoolId,
  });

  return NextResponse.json({ success: true });
}
