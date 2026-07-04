import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { rankReplacementTeachers } from "@/lib/teacher-ranking";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; teacherId: string }> }) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId },
    select: { subject: true },
  });
  if (!teacher) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const recommendations = await rankReplacementTeachers(schoolId, teacher.subject, teacherId);
  return NextResponse.json(recommendations.slice(0, 5));
}
