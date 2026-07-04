import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import {
  homeworkIncludeForList,
  normalizeSubject,
  parseRequiredDate,
  validateHomeworkTeacherAssignment,
} from "@/lib/homework";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; homeworkId: string }> }
) {
  const { schoolId, homeworkId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "HOMEWORK");
    if (denied) return denied;
  }

  const homework = await prisma.homework.findFirst({ where: { id: homeworkId, schoolId } });
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });
  if (homework.status === "CANCELLED") {
    return NextResponse.json({ error: "Cancelled homework cannot be updated" }, { status: 400 });
  }

  const body = await req.json();
  const data: {
    title?: string;
    description?: string | null;
    dueDate?: Date;
    deadlineAt?: Date;
    attachmentUrl?: string | null;
    status?: "ACTIVE" | "CLOSED" | "CANCELLED";
    sectionId?: string;
    subject?: string;
    teacherId?: string;
  } = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    data.title = title;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if (body.attachmentUrl !== undefined) {
    data.attachmentUrl = typeof body.attachmentUrl === "string" && body.attachmentUrl.trim() ? body.attachmentUrl.trim() : null;
  }
  if (body.dueDate !== undefined) {
    const dueDate = parseRequiredDate(body.dueDate);
    if (!dueDate) return NextResponse.json({ error: "Valid due date is required" }, { status: 400 });
    data.dueDate = dueDate;
    data.deadlineAt = dueDate;
  }
  if (body.status !== undefined) {
    if (!["ACTIVE", "CLOSED", "CANCELLED"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid homework status" }, { status: 400 });
    }
    data.status = body.status;
  }

  const nextTeacherId = typeof body.teacherId === "string" ? body.teacherId : homework.teacherId;
  const nextSectionId = typeof body.sectionId === "string" ? body.sectionId : homework.sectionId;
  const nextSubject = body.subject !== undefined ? normalizeSubject(body.subject) : homework.subject;
  if (body.subject !== undefined && !nextSubject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }

  if (
    nextTeacherId !== homework.teacherId ||
    nextSectionId !== homework.sectionId ||
    nextSubject.toLowerCase() !== homework.subject.toLowerCase()
  ) {
    const assignmentError = await validateHomeworkTeacherAssignment(schoolId, nextTeacherId, nextSectionId, nextSubject);
    if (assignmentError) return NextResponse.json({ error: assignmentError }, { status: 400 });
    data.teacherId = nextTeacherId;
    data.sectionId = nextSectionId;
    data.subject = nextSubject;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const nextHomework = await tx.homework.update({
      where: { id: homework.id },
      data,
    });

    if (data.sectionId && data.sectionId !== homework.sectionId) {
      const students = await tx.student.findMany({
        where: { schoolId, sectionId: data.sectionId },
        select: { id: true },
      });
      await tx.homeworkStudentStatus.deleteMany({ where: { homeworkId: homework.id } });
      if (students.length > 0) {
        await tx.homeworkStudentStatus.createMany({
          data: students.map((student) => ({
            homeworkId: homework.id,
            studentId: student.id,
            status: "PENDING",
          })),
        });
      }
    }

    return tx.homework.findUnique({
      where: { id: nextHomework.id },
      include: homeworkIncludeForList(),
    });
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; homeworkId: string }> }
) {
  const { schoolId, homeworkId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "HOMEWORK");
    if (denied) return denied;
  }

  const homework = await prisma.homework.findFirst({ where: { id: homeworkId, schoolId } });
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });

  const cancelled = await prisma.homework.update({
    where: { id: homework.id },
    data: { status: "CANCELLED" },
    include: homeworkIncludeForList(),
  });

  return NextResponse.json(cancelled);
}
