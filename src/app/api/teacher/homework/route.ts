import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import {
  getTeacherAssignments,
  getTeacherByUserId,
  homeworkIncludeForList,
  normalizeSubject,
  parseRequiredDate,
  validateHomeworkTeacherAssignment,
} from "@/lib/homework";
import {
  assertTeacherScopeAccess,
  filterTeacherScope,
  getResolvedTeacherScope,
  requireTeacherPermission,
  scopeForbidden,
} from "@/lib/teacher-permission-guard";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "VIEW");
  if (denied) return denied;
  const scope = await getResolvedTeacherScope(teacher.id, teacher.schoolId);

  const assignments = await getTeacherAssignments(teacher.id, teacher.schoolId);
  const accessFilters = assignments.map((assignment) => ({
    sectionId: assignment.sectionId,
    subject: { equals: assignment.subject, mode: "insensitive" as const },
  }));

  const homework = await prisma.homework.findMany({
    where: {
      schoolId: teacher.schoolId,
      AND: [{ OR: [{ teacherId: teacher.id }, ...accessFilters] }, filterTeacherScope(scope)],
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

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "CREATE");
  if (denied) return denied;

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

  const scope = await getResolvedTeacherScope(teacher.id, teacher.schoolId);
  if (!assertTeacherScopeAccess(scope, sectionId)) return scopeForbidden();

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
