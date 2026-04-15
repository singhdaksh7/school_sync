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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; studentId: string }> }
) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [student, school, attendances, examResults] = await Promise.all([
    prisma.student.findFirst({
      where: { id: studentId, schoolId },
      include: { section: { include: { class: true } } },
    }),
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, address: true, logoUrl: true } }),
    prisma.attendance.findMany({
      where: { studentId, schoolId },
      select: { status: true },
    }),
    prisma.examResult.findMany({
      where: { studentId, exam: { scheme: { schoolId } } },
      include: {
        exam: { include: { scheme: { select: { id: true, name: true } } } },
      },
      orderBy: [{ exam: { scheme: { name: "asc" } } }, { exam: { order: "asc" } }],
    }),
  ]);

  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  // Attendance summary
  const totalDays = attendances.length;
  const presentDays = attendances.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : null;

  // Group results by scheme
  const schemeMap = new Map<string, { schemeName: string; exams: { name: string; marks: number; maxMarks: number; order: number }[] }>();
  for (const r of examResults) {
    const key = r.exam.scheme.id;
    const entry = schemeMap.get(key) || { schemeName: r.exam.scheme.name, exams: [] };
    entry.exams.push({ name: r.exam.name, marks: r.marks, maxMarks: r.exam.maxMarks, order: r.exam.order });
    schemeMap.set(key, entry);
  }

  const schemes = Array.from(schemeMap.values()).map((s) => {
    const exams = s.exams.sort((a, b) => a.order - b.order);
    const totalMarks = exams.reduce((sum, e) => sum + e.marks, 0);
    const totalMax = exams.reduce((sum, e) => sum + e.maxMarks, 0);
    const pct = totalMax > 0 ? Math.round((totalMarks / totalMax) * 100) : null;
    return { schemeName: s.schemeName, exams, totalMarks, totalMax, pct };
  });

  return NextResponse.json({ student, school, attendancePct, presentDays, totalDays, schemes });
}
