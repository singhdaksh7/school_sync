import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; teacherId: string }> }) {
  const { schoolId, teacherId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId },
    include: {
      mentorSection: { include: { class: { select: { name: true } } } },
      _count: { select: { timetableSlots: true, generatedReportCards: true } },
    },
  });
  if (!teacher) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    isMentor: Boolean(teacher.mentorSectionId),
    mentorSectionName: teacher.mentorSection
      ? `${teacher.mentorSection.class.name} - ${teacher.mentorSection.name}`
      : null,
    upcomingSlotCount: teacher._count.timetableSlots,
    hasGeneratedReportCards: teacher._count.generatedReportCards > 0,
  });
}
