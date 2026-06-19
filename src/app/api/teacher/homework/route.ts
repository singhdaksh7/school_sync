import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { logAudit } from "@/lib/audit";
import {
  getTeacherAssignments,
  getTeacherByUserId,
  homeworkIncludeForList,
  normalizeSubject,
  parseRequiredDate,
  validateHomeworkTeacherAssignment,
} from "@/lib/homework";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "VIEW");
  if (denied) return denied;

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
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
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

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "CREATE", { sectionId });
  if (denied) return denied;

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

  if (created) {
    await logAudit({
      action: "HOMEWORK_CREATED",
      entityType: "Homework",
      entityId: created.id,
      metadata: { title: created.title, subject: created.subject, sectionId: created.sectionId },
      userId: teacherAuth.userId,
      schoolId: teacher.schoolId,
    });
  }

  return NextResponse.json(created, { status: 201 });
}
