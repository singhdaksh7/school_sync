import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, classBelongsToSchool } from "@/lib/tenant";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; classId: string }> }) {
  const { schoolId, classId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await classBelongsToSchool(classId, schoolId))) return NextResponse.json({ error: "Class not found in this school" }, { status: 404 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Section name required" }, { status: 400 });

  try {
    const section = await prisma.section.create({ data: { name: name.trim(), classId } });
    return NextResponse.json(section, { status: 201 });
  } catch (err) {
    console.error("Create section error:", err);
    return NextResponse.json({ error: "Section already exists in this class" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; classId: string }> }) {
  const { schoolId, classId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await classBelongsToSchool(classId, schoolId))) return NextResponse.json({ error: "Class not found in this school" }, { status: 404 });

  try {
    const { sectionId } = await req.json();
    if (!sectionId) return NextResponse.json({ error: "sectionId required" }, { status: 400 });
    const result = await prisma.section.deleteMany({ where: { id: sectionId, classId } });
    if (result.count === 0) return NextResponse.json({ error: "Section not found in this class" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete section error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
