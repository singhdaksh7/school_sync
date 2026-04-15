import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

const schema = z.object({
  toSectionId: z.string().min(1),
  reason: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; studentId: string }> }
) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { toSectionId, reason } = schema.parse(body);

    const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (student.sectionId === toSectionId) return NextResponse.json({ error: "Student is already in this section" }, { status: 400 });

    // Verify target section belongs to the same school
    const toSection = await prisma.section.findFirst({
      where: { id: toSectionId, class: { schoolId } },
      include: { class: { select: { name: true } } },
    });
    if (!toSection) return NextResponse.json({ error: "Target section not found" }, { status: 404 });

    // Run transfer + history in a transaction
    const [transfer] = await prisma.$transaction([
      prisma.sectionTransfer.create({
        data: {
          studentId,
          fromSectionId: student.sectionId,
          toSectionId,
          reason: reason || null,
          transferredById: session.user.id,
          schoolId,
        },
      }),
      prisma.student.update({
        where: { id: studentId },
        data: { sectionId: toSectionId },
      }),
    ]);

    await logAudit({
      action: "STUDENT_TRANSFERRED",
      entityType: "Student",
      entityId: studentId,
      metadata: { studentName: student.name, fromSectionId: student.sectionId, toSectionId, reason },
      userId: session.user.id,
      schoolId,
    });

    return NextResponse.json(transfer, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; studentId: string }> }
) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const history = await prisma.sectionTransfer.findMany({
    where: { studentId, schoolId },
    include: {
      fromSection: { include: { class: { select: { name: true } } } },
      toSection: { include: { class: { select: { name: true } } } },
      transferredBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(history);
}
