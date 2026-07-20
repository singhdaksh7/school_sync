import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { sortStudentsByRollNumber } from "@/lib/student-ordering";

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
            select: { id: true, name: true, rollNo: true },
          },
        },
      },
    },
  });

  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  // Universal roll-number ordering (canonical comparator — see /lib/student-ordering).
  if (teacher.mentorSection) {
    teacher.mentorSection.students = sortStudentsByRollNumber(teacher.mentorSection.students);
  }
  return NextResponse.json(teacher);
}
