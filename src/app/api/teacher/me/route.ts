import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherAuth.teacherId },
    include: {
      school: { select: { id: true, name: true, slug: true } },
      mentorSection: {
        include: {
          class: { select: { id: true, name: true } },
          students: {
            orderBy: { rollNo: "asc" },
            select: { id: true, name: true, rollNo: true },
          },
        },
      },
    },
  });

  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  return NextResponse.json(teacher);
}
