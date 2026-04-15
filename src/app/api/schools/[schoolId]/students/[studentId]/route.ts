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
  rollNo: z.string().min(1),
  sectionId: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  parentName: z.string().optional(),
  parentPhone: z.string().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; studentId: string }> }) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const student = await prisma.student.findUnique({
    where: { id: studentId, schoolId },
    include: {
      section: { include: { class: true } },
      attendances: { orderBy: { date: "desc" }, take: 60 },
      examResults: {
        include: { exam: { include: { scheme: true } } },
        orderBy: [{ exam: { scheme: { name: "asc" } } }, { exam: { order: "asc" } }],
      },
    },
  });

  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(student);
}

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string; studentId: string }> }) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = schema.parse(body);
    const student = await prisma.student.update({
      where: { id: studentId },
      data: {
        name: data.name, rollNo: data.rollNo, sectionId: data.sectionId,
        email: data.email || null, phone: data.phone || null,
        parentName: data.parentName || null, parentPhone: data.parentPhone || null,
      },
      include: { section: { include: { class: true } } },
    });
    return NextResponse.json(student);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; studentId: string }> }) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.student.delete({ where: { id: studentId } });
  return NextResponse.json({ success: true });
}
