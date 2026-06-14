import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfDay, subDays } from "date-fns";
import { getTeacherAuth } from "@/lib/mobile-auth";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherAuth.teacherId },
    select: { id: true, schoolId: true },
  });
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const today = startOfDay(new Date());
  const pastLimit = subDays(today, 7); // Show last 7 days + future

  const arrangements = await prisma.arrangement.findMany({
    where: {
      schoolId: teacher.schoolId,
      substituteTeacherId: teacher.id,
      date: { gte: pastLimit },
    },
    include: {
      absentTeacher: { select: { name: true, subject: true } },
      section: { include: { class: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }, { period: "asc" }],
  });

  return NextResponse.json(arrangements);
}
