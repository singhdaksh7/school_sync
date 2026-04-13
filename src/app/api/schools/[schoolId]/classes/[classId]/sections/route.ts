import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function verify(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; classId: string }> }) {
  const { schoolId, classId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Section name required" }, { status: 400 });

  try {
    const section = await prisma.section.create({ data: { name: name.trim(), classId } });
    return NextResponse.json(section, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Section already exists in this class" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; classId: string }> }) {
  const { schoolId, classId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { sectionId } = await req.json();
  await prisma.section.delete({ where: { id: sectionId } });
  return NextResponse.json({ success: true });
}
