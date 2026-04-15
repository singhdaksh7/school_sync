import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

async function verify(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

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
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = schema.parse(body);

    // If assigning a new mentor section, clear any previous teacher's assignment for that section
    if (data.mentorSectionId) {
      await prisma.teacher.updateMany({
        where: { mentorSectionId: data.mentorSectionId, id: { not: teacherId } },
        data: { mentorSectionId: null },
      });
    }

    const teacher = await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        subject: data.subject || null,
        mentorSectionId: data.mentorSectionId ?? null,
      },
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
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.teacher.delete({ where: { id: teacherId } });
  return NextResponse.json({ success: true });
}
