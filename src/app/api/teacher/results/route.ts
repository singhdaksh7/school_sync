import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({ where: { userId: session.user.id } });
  if (!teacher) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const examId = searchParams.get("examId");
  const sectionId = searchParams.get("sectionId");

  if (!examId || !sectionId) return NextResponse.json({ error: "examId and sectionId required" }, { status: 400 });

  const results = await prisma.examResult.findMany({
    where: { examId, student: { sectionId } },
    select: { studentId: true, marks: true },
  });
  return NextResponse.json(results);
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({ where: { userId } });
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const { examId, sectionId, results } = await req.json();
  if (!examId || !sectionId || !Array.isArray(results)) {
    return NextResponse.json({ error: "examId, sectionId, and results required" }, { status: 400 });
  }

  // Verify teacher is assigned to this section (via timetable or mentor)
  const isAssigned = teacher.mentorSectionId === sectionId ||
    (await prisma.timetableSlot.findFirst({ where: { teacherId: teacher.id, sectionId } })) !== null;

  if (!isAssigned) return NextResponse.json({ error: "You are not assigned to this section" }, { status: 403 });

  // Verify exam exists
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { scheme: true } });
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });

  const upserts = (results as { studentId: string; marks: number }[]).map((r) =>
    prisma.examResult.upsert({
      where: { examId_studentId: { examId, studentId: r.studentId } },
      create: {
        examId,
        studentId: r.studentId,
        marks: Math.min(r.marks, exam.maxMarks),
        submittedById: userId,
      },
      update: {
        marks: Math.min(r.marks, exam.maxMarks),
        submittedById: userId,
      },
    })
  );

  await prisma.$transaction(upserts);
  return NextResponse.json({ success: true });
}
