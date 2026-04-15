import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({
    where: { userId: session.user.id },
    include: {
      timetableSlots: {
        include: {
          section: {
            include: {
              class: { select: { name: true } },
              students: { orderBy: { rollNo: "asc" }, select: { id: true, name: true, rollNo: true } },
            },
          },
        },
        orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
      },
    },
  });

  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  // Deduplicate sections teacher is assigned to teach
  const sectionMap = new Map<string, {
    sectionId: string;
    sectionName: string;
    className: string;
    subject: string;
    students: { id: string; name: string; rollNo: string }[];
  }>();

  for (const slot of teacher.timetableSlots) {
    const key = `${slot.sectionId}|${slot.subject || ""}`;
    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        sectionId: slot.sectionId,
        sectionName: slot.section.name,
        className: slot.section.class.name,
        subject: slot.subject || teacher.subject || "",
        students: slot.section.students,
      });
    }
  }

  // Raw slots for timetable grid view
  const slots = teacher.timetableSlots.map((slot) => ({
    dayOfWeek: slot.dayOfWeek,
    period: slot.period,
    subject: slot.subject,
    sectionName: slot.section.name,
    className: slot.section.class.name,
  }));

  const schoolPeriodsPerDay = teacher.timetableSlots.length > 0
    ? await prisma.school.findFirst({
        where: { id: teacher.schoolId },
        select: { periodsPerDay: true },
      }).then((s) => s?.periodsPerDay ?? 6)
    : 6;

  return NextResponse.json({ teachingSections: Array.from(sectionMap.values()), slots, periodsPerDay: schoolPeriodsPerDay });
}
