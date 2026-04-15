import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teachers = await prisma.teacher.findMany({
    where: { schoolId },
    include: {
      timetableSlots: {
        include: {
          section: { include: { class: { select: { name: true } } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const workload = teachers.map((t) => {
    const slots = t.timetableSlots;
    const periodsPerWeek = slots.length;

    // Unique sections taught
    const sectionSet = new Map<string, string>();
    for (const s of slots) {
      const key = s.sectionId;
      if (!sectionSet.has(key)) {
        sectionSet.set(key, `${s.section.class.name}-${s.section.name}`);
      }
    }

    // Unique subjects
    const subjects = [...new Set(slots.map((s) => s.subject).filter(Boolean))] as string[];

    // Periods per day breakdown (dayOfWeek → count)
    const perDay: Record<number, number> = {};
    for (const s of slots) {
      perDay[s.dayOfWeek] = (perDay[s.dayOfWeek] || 0) + 1;
    }

    // Busiest day
    let busiestDay = 0;
    let busiestCount = 0;
    for (const [day, count] of Object.entries(perDay)) {
      if (count > busiestCount) { busiestCount = count; busiestDay = Number(day); }
    }

    return {
      id: t.id,
      name: t.name,
      email: t.email,
      subject: t.subject,
      periodsPerWeek,
      sections: Array.from(sectionSet.values()),
      subjects,
      perDay,
      busiestDay,
      busiestCount,
      isMentor: !!t.mentorSectionId,
    };
  });

  return NextResponse.json(workload);
}
