import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import {
  getTeacherAssignments,
  getTeacherByUserId,
  homeworkIncludeForList,
  normalizeSubject,
  parseRequiredDate,
  validateHomeworkTeacherAssignment,
} from "@/lib/homework";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherByUserId(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const assignments = await getTeacherAssignments(teacher.id, teacher.schoolId);
  const accessFilters = assignments.map((assignment) => ({
    sectionId: assignment.sectionId,
    subject: { equals: assignment.subject, mode: "insensitive" as const },
  }));

  const homework = await prisma.homework.findMany({
    where: {
      schoolId: teacher.schoolId,
      OR: [{ teacherId: teacher.id }, ...accessFilters],
    },
    include: homeworkIncludeForList(),
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ assignments, homework });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherByUserId(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subject = normalizeSubject(body.subject);
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : "";
  const dueDate = parseRequiredDate(body.dueDate);
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const attachmentUrl = typeof body.attachmentUrl === "string" && body.attachmentUrl.trim() ? body.attachmentUrl.trim() : null;

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (!sectionId) return NextResponse.json({ error: "Section is required" }, { status: 400 });
  if (!dueDate) return NextResponse.json({ error: "Valid due date is required" }, { status: 400 });

  const assignmentError = await validateHomeworkTeacherAssignment(teacher.schoolId, teacher.id, sectionId, subject);
  if (assignmentError) return NextResponse.json({ error: assignmentError }, { status: 403 });

  const students = await prisma.student.findMany({
    where: { schoolId: teacher.schoolId, sectionId },
    select: { id: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const homework = await tx.homework.create({
      data: {
        schoolId: teacher.schoolId,
        sectionId,
        teacherId: teacher.id,
        subject,
        title,
        description,
        dueDate,
        deadlineAt: dueDate,
        attachmentUrl,
      },
    });

    if (students.length > 0) {
      await tx.homeworkStudentStatus.createMany({
        data: students.map((student) => ({
          homeworkId: homework.id,
          studentId: student.id,
          status: "PENDING",
        })),
      });
    }

    return tx.homework.findUnique({
      where: { id: homework.id },
      include: homeworkIncludeForList(),
    });
  });

  return NextResponse.json(created, { status: 201 });
}
