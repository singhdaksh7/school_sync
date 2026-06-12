import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { canAccessSchool, hasPrismaErrorCode, sectionBelongsToSchool } from "@/lib/tenant";

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
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = schema.parse(body);
    if (!(await sectionBelongsToSchool(data.sectionId, schoolId))) {
      return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
    }

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
    await logAudit({ action: "STUDENT_CREATED", entityType: "Student", entityId: student.id, metadata: { name: student.name, rollNo: student.rollNo }, userId: session.user.id, schoolId });
    return NextResponse.json(student, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: "Roll number already exists" }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
