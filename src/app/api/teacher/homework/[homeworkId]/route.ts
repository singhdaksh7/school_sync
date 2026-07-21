import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { enqueueNotificationFanout, guardianRecipientsForStudents, type RecipientRef } from "@/lib/notifications";
import {
  editHomeworkSchema,
  getHomeworkForTeacherAccess,
  getTeacherByUserId,
  homeworkIncludeForList,
  normalizeSubject,
  parseRequiredDate,
  validateAssessmentMode,
  validateHomeworkDates,
  validateHomeworkTeacherAssignment,
  validateStatusTransition,
  withResolvedAttachments,
  type HomeworkLifecycleStatus,
} from "@/lib/homework";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ homeworkId: string }> }
) {
  const { homeworkId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const homework = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });
  if (homework.status === "CANCELLED") {
    return NextResponse.json({ error: "Cancelled homework cannot be updated" }, { status: 400 });
  }

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "EDIT", {
    sectionId: homework.sectionId,
  });
  if (denied) return denied;

  const rawBody = await req.json().catch(() => null);
  const parsed = editHomeworkSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;

  const data: {
    title?: string;
    description?: string | null;
    dueDate?: Date;
    deadlineAt?: Date;
    checkingDeadlineAt?: Date | null;
    attachmentUrl?: string | null;
    assessmentMode?: "CHECKING_ONLY" | "GRADED";
    maxMarks?: number | null;
    status?: HomeworkLifecycleStatus;
    sectionId?: string;
    subject?: string;
  } = {};

  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description?.trim() || null;
  if (body.attachmentUrl !== undefined) data.attachmentUrl = body.attachmentUrl?.trim() || null;

  if (body.dueDate !== undefined) {
    const dueDate = parseRequiredDate(body.dueDate);
    if (!dueDate) return NextResponse.json({ error: "Valid start date is required" }, { status: 400 });
    data.dueDate = dueDate;
  }
  if (body.deadlineAt !== undefined) {
    const deadlineAt = parseRequiredDate(body.deadlineAt);
    if (!deadlineAt) return NextResponse.json({ error: "Valid submission deadline is required" }, { status: 400 });
    data.deadlineAt = deadlineAt;
  }
  if (body.checkingDeadlineAt !== undefined) {
    if (body.checkingDeadlineAt === null) {
      data.checkingDeadlineAt = null;
    } else {
      const checkingDeadlineAt = parseRequiredDate(body.checkingDeadlineAt);
      if (!checkingDeadlineAt) return NextResponse.json({ error: "Valid checking deadline is required" }, { status: 400 });
      data.checkingDeadlineAt = checkingDeadlineAt;
    }
  }

  const effectiveDueDate = data.dueDate ?? homework.dueDate;
  const effectiveDeadlineAt = data.deadlineAt ?? homework.deadlineAt;
  const effectiveCheckingDeadlineAt = data.checkingDeadlineAt !== undefined ? data.checkingDeadlineAt : homework.checkingDeadlineAt;
  if (data.dueDate || data.deadlineAt || data.checkingDeadlineAt !== undefined) {
    const dateError = validateHomeworkDates({
      dueDate: effectiveDueDate,
      deadlineAt: effectiveDeadlineAt,
      checkingDeadlineAt: effectiveCheckingDeadlineAt,
    });
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });
  }

  if (body.assessmentMode !== undefined || body.maxMarks !== undefined) {
    const effectiveMode = body.assessmentMode ?? homework.assessmentMode;
    const effectiveMaxMarks = body.maxMarks !== undefined ? body.maxMarks : homework.maxMarks;
    const modeError = validateAssessmentMode({ assessmentMode: effectiveMode, maxMarks: effectiveMaxMarks });
    if (modeError) return NextResponse.json({ error: modeError }, { status: 400 });
    data.assessmentMode = effectiveMode;
    data.maxMarks = effectiveMaxMarks;
  }

  let auditAction: "HOMEWORK_UPDATED" | "HOMEWORK_PUBLISHED" | "HOMEWORK_CLOSED" | "HOMEWORK_CANCELLED" = "HOMEWORK_UPDATED";
  if (body.status !== undefined) {
    const transitionError = validateStatusTransition(homework.status, body.status);
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 400 });
    data.status = body.status;
    if (body.status === "ACTIVE" && homework.status !== "ACTIVE") auditAction = "HOMEWORK_PUBLISHED";
    else if (body.status === "CLOSED") auditAction = "HOMEWORK_CLOSED";
    else if (body.status === "CANCELLED") auditAction = "HOMEWORK_CANCELLED";
  }

  const nextSectionId = body.sectionId ?? homework.sectionId;
  const nextSubject = body.subject !== undefined ? normalizeSubject(body.subject) : homework.subject;
  if (body.subject !== undefined && !nextSubject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }

  if (nextSectionId !== homework.sectionId || nextSubject.toLowerCase() !== homework.subject.toLowerCase()) {
    const assignmentError = await validateHomeworkTeacherAssignment(teacher.schoolId, teacher.id, nextSectionId, nextSubject);
    if (assignmentError) return NextResponse.json({ error: assignmentError }, { status: 403 });
    data.sectionId = nextSectionId;
    data.subject = nextSubject;
  }

  // GRADED -> CHECKING_ONLY must never leave stale marks behind: checking-only
  // homework can never show a score (see validateStudentMarks), so any score/
  // maxScore recorded while this homework was GRADED has to be cleared in the
  // same transaction as the mode change — not just hidden by shouldShowMaxMarks
  // at read time, which would leave the raw values sitting in the DB and any
  // response path that forgets the gate would leak them. Completion/checking
  // state, submission content, attachments, and feedback are untouched.
  const clearingMarksOnModeSwitch = data.assessmentMode === "CHECKING_ONLY" && homework.assessmentMode === "GRADED";

  const updated = await prisma.$transaction(async (tx) => {
    const nextHomework = await tx.homework.update({
      where: { id: homework.id },
      data,
    });

    if (clearingMarksOnModeSwitch) {
      await tx.homeworkStudentStatus.updateMany({
        where: { homeworkId: homework.id },
        data: { score: null, maxScore: null },
      });
      await tx.homeworkSubmission.updateMany({
        where: { homeworkId: homework.id },
        data: { score: null, maxScore: null },
      });
    }

    if (data.sectionId && data.sectionId !== homework.sectionId) {
      const students = await tx.student.findMany({
        where: { schoolId: teacher.schoolId, sectionId: data.sectionId },
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

    // Fan out only for a genuine "just published" transition or a correction
    // to a homework that was already ACTIVE — never for a DRAFT/SCHEDULED
    // edit nobody has seen yet.
    const isFreshPublish = auditAction === "HOMEWORK_PUBLISHED";
    const isCorrectionToActive = auditAction === "HOMEWORK_UPDATED" && homework.status === "ACTIVE";
    if (isFreshPublish || isCorrectionToActive) {
      const targetSectionId = nextHomework.sectionId;
      const targetStudents = await tx.student.findMany({ where: { schoolId: teacher.schoolId, sectionId: targetSectionId }, select: { id: true } });
      if (targetStudents.length > 0) {
        const studentIds = targetStudents.map((s) => s.id);
        const studentRecipients: RecipientRef[] = studentIds.map((studentId) => ({ recipientType: "STUDENT", recipientId: studentId }));
        const guardianRecipients = await guardianRecipientsForStudents(studentIds);
        await enqueueNotificationFanout(tx, {
          schoolId: teacher.schoolId,
          eventType: isFreshPublish ? "HOMEWORK_PUBLISHED" : "HOMEWORK_UPDATED",
          entityType: "Homework",
          entityId: nextHomework.id,
          recipients: [...studentRecipients, ...guardianRecipients],
          metadata: { subject: nextHomework.subject, sectionId: targetSectionId },
          // updatedAt is bumped by every write, so a genuinely new correction
          // (a fresh updatedAt) always gets its own notification, while a
          // retried identical PATCH re-applying the SAME updatedAt collapses.
          versionKey: isCorrectionToActive ? nextHomework.updatedAt.toISOString() : undefined,
        });
      }
    }

    return tx.homework.findUnique({
      where: { id: nextHomework.id },
      include: homeworkIncludeForList(),
    });
  });

  if (updated) {
    await logAudit({
      action: auditAction,
      entityType: "Homework",
      entityId: updated.id,
      metadata: { title: updated.title, status: updated.status, assessmentMode: updated.assessmentMode },
      userId: teacherAuth.userId,
      schoolId: teacher.schoolId,
    });
  }

  return NextResponse.json(updated ? await withResolvedAttachments(updated) : updated);
}
