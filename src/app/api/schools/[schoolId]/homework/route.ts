import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import {
  getTeacherAssignments,
  homeworkIncludeForList,
  normalizeSubject,
  parseRequiredDate,
  validateHomeworkTeacherAssignment,
  withResolvedAttachments,
} from "@/lib/homework";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "HOMEWORK");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId") || undefined;
  const sectionId = searchParams.get("sectionId") || undefined;
  const subject = normalizeSubject(searchParams.get("subject"));
  const teacherId = searchParams.get("teacherId") || undefined;
  const status = searchParams.get("status") || undefined;

  // Admin dashboard needs the full filtered set to manage (edit/close/cancel),
  // so the ceiling is generous rather than a small default page.
  const { skip, take, page, limit } = parsePagination(searchParams, { maxLimit: 500, defaultLimit: 500 });
  const where = {
    schoolId,
    ...(sectionId ? { sectionId } : {}),
    ...(classId ? { section: { classId } } : {}),
    ...(subject ? { subject: { equals: subject, mode: "insensitive" as const } } : {}),
    ...(teacherId ? { teacherId } : {}),
    ...(status ? { status: status as "ACTIVE" | "CLOSED" | "CANCELLED" } : {}),
  };
  const [homework, total] = await Promise.all([
    prisma.homework.findMany({
      where,
      include: homeworkIncludeForList(),
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.homework.count({ where }),
  ]);

  const teachers = await prisma.teacher.findMany({
    where: { schoolId, isDeleted: false },
    select: { id: true, name: true, subject: true },
    orderBy: { name: "asc" },
  });
  const assignmentsByTeacher = await Promise.all(
    teachers.map(async (teacher) => ({
      teacherId: teacher.id,
      teacherName: teacher.name,
      assignments: await getTeacherAssignments(teacher.id, schoolId),
    }))
  );

  return NextResponse.json({
    homework: await Promise.all(homework.map(withResolvedAttachments)),
    pagination: buildPaginationMeta(total, page, limit),
    assignmentsByTeacher,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "HOMEWORK");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subject = normalizeSubject(body.subject);
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : "";
  const teacherId = typeof body.teacherId === "string" ? body.teacherId : "";
  const dueDate = parseRequiredDate(body.dueDate);
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const attachmentUrl = typeof body.attachmentUrl === "string" && body.attachmentUrl.trim() ? body.attachmentUrl.trim() : null;

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (!sectionId) return NextResponse.json({ error: "Section is required" }, { status: 400 });
  if (!teacherId) return NextResponse.json({ error: "Teacher is required" }, { status: 400 });
  if (!dueDate) return NextResponse.json({ error: "Valid due date is required" }, { status: 400 });

  const assignmentError = await validateHomeworkTeacherAssignment(schoolId, teacherId, sectionId, subject);
  if (assignmentError) return NextResponse.json({ error: assignmentError }, { status: 400 });

  const students = await prisma.student.findMany({
    where: { schoolId, sectionId },
    select: { id: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const homework = await tx.homework.create({
      data: {
        schoolId,
        sectionId,
        teacherId,
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

  return NextResponse.json(created ? await withResolvedAttachments(created) : created, { status: 201 });
}
