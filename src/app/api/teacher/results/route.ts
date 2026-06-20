import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allStudentsBelongToSchool, getExamInSchool, sectionBelongsToSchool, sessionRole } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({ where: { userId: session.user.id } });
  if (!teacher) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const examId = searchParams.get("examId");
  const sectionId = searchParams.get("sectionId");

  if (!examId || !sectionId) return NextResponse.json({ error: "examId and sectionId required" }, { status: 400 });

  const [sectionOk, exam] = await Promise.all([
    sectionBelongsToSchool(sectionId, teacher.schoolId),
    getExamInSchool(examId, teacher.schoolId),
  ]);
  if (!sectionOk || !exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAssigned = teacher.mentorSectionId === sectionId ||
    (await prisma.timetableSlot.findFirst({ where: { schoolId: teacher.schoolId, teacherId: teacher.id, sectionId } })) !== null;
  if (!isAssigned) return NextResponse.json({ error: "You are not assigned to this section" }, { status: 403 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "MARKS", "VIEW", { sectionId });
  if (denied) return denied;

  const results = await prisma.examResult.findMany({
    where: { examId: exam.id, student: { schoolId: teacher.schoolId, sectionId } },
    select: { studentId: true, marks: true },
  });
  return NextResponse.json(results);
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({ where: { userId } });
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const { examId, sectionId, results } = await req.json();
  if (!examId || !sectionId || !Array.isArray(results)) {
    return NextResponse.json({ error: "examId, sectionId, and results required" }, { status: 400 });
  }

  // Verify teacher is assigned to this section (via timetable or mentor)
  const isAssigned = teacher.mentorSectionId === sectionId ||
    (await prisma.timetableSlot.findFirst({ where: { schoolId: teacher.schoolId, teacherId: teacher.id, sectionId } })) !== null;

  if (!isAssigned) return NextResponse.json({ error: "You are not assigned to this section" }, { status: 403 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "MARKS", "ENTER", { sectionId });
  if (denied) return denied;

  const [sectionOk, exam] = await Promise.all([
    sectionBelongsToSchool(sectionId, teacher.schoolId),
    getExamInSchool(examId, teacher.schoolId),
  ]);
  if (!sectionOk) return NextResponse.json({ error: "Section not found in this school" }, { status: 404 });
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });

  const submitted = results as { studentId: string; marks: number }[];
  if (!(await allStudentsBelongToSchool(submitted.map((r) => r.studentId), teacher.schoolId, sectionId))) {
    return NextResponse.json({ error: "One or more students are not in this section" }, { status: 400 });
  }

  const upserts = submitted.map((r) =>
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
