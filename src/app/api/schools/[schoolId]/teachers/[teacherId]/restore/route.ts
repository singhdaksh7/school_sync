import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ schoolId: string; teacherId: string }> }) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId, isDeleted: true }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const teacher = await prisma.teacher.update({
    where: { id: teacherId },
    data: { isDeleted: false, deletedAt: null, deletedById: null },
  });

  await logAudit({
    action: "TEACHER_RESTORED",
    entityType: "Teacher",
    entityId: teacherId,
    userId: session.user.id,
    schoolId,
  });

  return NextResponse.json(teacher);
}
