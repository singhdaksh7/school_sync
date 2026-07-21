import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { enqueueNotificationFanout, guardianRecipientsForStudents, type RecipientRef } from "@/lib/notifications";
import {
  createHomeworkSchema,
  getTeacherAssignments,
  getTeacherByUserId,
  homeworkIncludeForList,
  normalizeSubject,
  parseRequiredDate,
  validateAssessmentMode,
  validateHomeworkDates,
  validateHomeworkTeacherAssignment,
  withResolvedAttachments,
} from "@/lib/homework";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

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

  return NextResponse.json({ assignments, homework: await Promise.all(homework.map(withResolvedAttachments)) });
}

export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const rawBody = await req.json().catch(() => null);
  const parsed = createHomeworkSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;

  const title = body.title;
  const subject = normalizeSubject(body.subject);
  const sectionId = body.sectionId;
  const dueDate = parseRequiredDate(body.dueDate);
  // deadlineAt is required (createHomeworkSchema enforces the field is
  // present) — no silent default to dueDate. See the schema's doc comment.
  const deadlineAt = parseRequiredDate(body.deadlineAt);
  const checkingDeadlineAt = body.checkingDeadlineAt ? parseRequiredDate(body.checkingDeadlineAt) : null;
  const description = body.description?.trim() || null;
  const attachmentUrl = body.attachmentUrl?.trim() || null;
  const maxMarks = body.maxMarks ?? null;

  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (!dueDate) return NextResponse.json({ error: "Valid start date is required" }, { status: 400 });
  if (!deadlineAt) return NextResponse.json({ error: "Valid submission deadline is required" }, { status: 400 });
  if (body.checkingDeadlineAt && !checkingDeadlineAt) {
    return NextResponse.json({ error: "Valid checking deadline is required" }, { status: 400 });
  }

  const dateError = validateHomeworkDates({ dueDate, deadlineAt, checkingDeadlineAt });
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

  const modeError = validateAssessmentMode({ assessmentMode: body.assessmentMode, maxMarks });
  if (modeError) return NextResponse.json({ error: modeError }, { status: 400 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "CREATE", { sectionId });
  if (denied) return denied;

  // Never trust a client-supplied schoolId/teacherId — both come exclusively
  // from the authenticated teacher record resolved above, never from the
  // request body (createHomeworkSchema has no such fields at all).
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
        deadlineAt,
        checkingDeadlineAt,
        assessmentMode: body.assessmentMode,
        maxMarks,
        attachmentUrl,
        status: body.status,
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

    if (homework.status === "ACTIVE" && students.length > 0) {
      const studentIds = students.map((s) => s.id);
      const studentRecipients: RecipientRef[] = studentIds.map((studentId) => ({ recipientType: "STUDENT", recipientId: studentId }));
      const guardianRecipients = await guardianRecipientsForStudents(studentIds);
      await enqueueNotificationFanout(tx, {
        schoolId: teacher.schoolId,
        eventType: "HOMEWORK_PUBLISHED",
        entityType: "Homework",
        entityId: homework.id,
        recipients: [...studentRecipients, ...guardianRecipients],
        metadata: { subject: homework.subject, sectionId },
      });
    }

    return tx.homework.findUnique({
      where: { id: homework.id },
      include: homeworkIncludeForList(),
    });
  });

  if (created) {
    await logAudit({
      action: created.status === "DRAFT" ? "HOMEWORK_CREATED" : "HOMEWORK_PUBLISHED",
      entityType: "Homework",
      entityId: created.id,
      metadata: {
        title: created.title,
        subject: created.subject,
        sectionId: created.sectionId,
        assessmentMode: created.assessmentMode,
        status: created.status,
      },
      userId: teacherAuth.userId,
      schoolId: teacher.schoolId,
    });
  }

  return NextResponse.json(created ? await withResolvedAttachments(created) : created, { status: 201 });
}
