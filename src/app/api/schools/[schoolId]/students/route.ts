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

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");

  const students = await prisma.student.findMany({
    where: { schoolId, ...(sectionId ? { sectionId } : {}) },
    include: { section: { include: { class: true } } },
    orderBy: [{ section: { class: { name: "asc" } } }, { rollNo: "asc" }],
  });
  return NextResponse.json(students);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = schema.parse(body);
    const student = await prisma.student.create({
      data: {
        name: data.name,
        rollNo: data.rollNo,
        email: data.email || null,
        phone: data.phone || null,
        parentName: data.parentName || null,
        parentPhone: data.parentPhone || null,
        sectionId: data.sectionId,
        schoolId,
      },
      include: { section: { include: { class: true } } },
    });
    return NextResponse.json(student, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if ((err as any)?.code === "P2002") return NextResponse.json({ error: "Roll number already exists" }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
