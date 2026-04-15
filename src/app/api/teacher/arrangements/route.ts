import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfDay, subDays } from "date-fns";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({
    where: { userId: session.user.id },
    select: { id: true, schoolId: true },
  });
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const today = startOfDay(new Date());
  const pastLimit = subDays(today, 7); // Show last 7 days + future

  const arrangements = await prisma.arrangement.findMany({
    where: {
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
