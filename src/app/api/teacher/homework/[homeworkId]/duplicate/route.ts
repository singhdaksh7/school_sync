import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { getHomeworkForTeacherAccess, getTeacherByUserId, homeworkIncludeForList, withResolvedAttachments } from "@/lib/homework";

/**
 * Duplicates an existing homework into a brand-new DRAFT — never carries
 * over any student roster state, submissions, scores, or remarks (private
 * or student-visible): a duplicate is a fresh authoring starting point, not
 * a data copy of a prior assignment's results.
 */
export async function POST(req: Request, { params }: { params: Promise<{ homeworkId: string }> }) {
  const { homeworkId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const source = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!source) return NextResponse.json({ error: "Homework not found" }, { status: 404 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "CREATE", {
    sectionId: source.sectionId,
  });
  if (denied) return denied;

  const created = await prisma.$transaction(async (tx) => {
    const homework = await tx.homework.create({
      data: {
        schoolId: teacher.schoolId,
        sectionId: source.sectionId,
        teacherId: teacher.id,
        subject: source.subject,
        title: `${source.title} (copy)`,
        description: source.description,
        dueDate: source.dueDate,
        deadlineAt: source.deadlineAt,
        checkingDeadlineAt: source.checkingDeadlineAt,
        assessmentMode: source.assessmentMode,
        maxMarks: source.maxMarks,
        // Attachment metadata is NOT copied — the managed file belongs to
        // the original homework record (attachmentFileId is @unique); a
        // duplicate starts with no attachment, same as any new draft.
        status: "DRAFT",
      },
    });

    return tx.homework.findUnique({
      where: { id: homework.id },
      include: homeworkIncludeForList(),
    });
  });

  if (created) {
    await logAudit({
      action: "HOMEWORK_DUPLICATED",
      entityType: "Homework",
      entityId: created.id,
      metadata: { title: created.title, sourceHomeworkId: source.id },
      userId: teacherAuth.userId,
      schoolId: teacher.schoolId,
    });
  }

  return NextResponse.json(created ? await withResolvedAttachments(created) : created, { status: 201 });
}
