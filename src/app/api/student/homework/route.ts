import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { resolveManagedOrLegacyUrl } from "@/lib/file-service";
import { isHomeworkVisibleToStudents, omitPrivateRemark, shouldShowMaxMarks } from "@/lib/homework";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const featureDenied = await requireSchoolFeature(auth.schoolId, "HOMEWORK");
    if (featureDenied) return featureDenied;

    const statuses = await prisma.homeworkStudentStatus.findMany({
      where: {
        studentId: auth.studentId,
        student: { schoolId: auth.schoolId },
        homework: {
          schoolId: auth.schoolId,
          status: { not: "CANCELLED" },
        },
      },
      include: {
        homework: {
          include: {
            teacher: { select: { id: true, name: true } },
            section: { include: { class: { select: { name: true } } } },
            submissions: {
              where: { studentId: auth.studentId, schoolId: auth.schoolId },
            },
          },
        },
      },
      orderBy: [{ homework: { dueDate: "asc" } }, { createdAt: "desc" }],
    });

    // Scheduled visibility: DRAFT is already excluded (never queried for a
    // student — see the `status: { not: "CANCELLED" }` filter above, which
    // still lets DRAFT through at the DB level), and SCHEDULED homework
    // whose start date/time hasn't arrived yet must not appear at all.
    const visibleStatuses = statuses.filter((item) => isHomeworkVisibleToStudents(item.homework));

    const homework = await Promise.all(visibleStatuses.map(async (item) => {
      const submission = item.homework.submissions.find((s) => s.studentId === item.studentId) || null;
      const [attachmentUrl, submissionAttachmentUrl] = await Promise.all([
        resolveManagedOrLegacyUrl(item.homework),
        submission ? resolveManagedOrLegacyUrl(submission) : Promise.resolve(null),
      ]);
      return {
        id: item.id,
        homeworkId: item.homeworkId,
        studentId: item.studentId,
        title: item.homework.title,
        description: item.homework.description,
        subject: item.homework.subject,
        assignedAt: item.homework.createdAt,
        dueDate: item.homework.dueDate,
        deadlineAt: item.homework.deadlineAt,
        checkingDeadlineAt: item.homework.checkingDeadlineAt,
        assessmentMode: item.homework.assessmentMode,
        maxMarks: shouldShowMaxMarks(item.homework.assessmentMode) ? item.homework.maxMarks : null,
        attachmentUrl,
        homeworkStatus: item.homework.status,
        submissionStatus: submission?.submissionStatus ?? item.submissionStatus,
        submissionMethod: submission?.submissionMethod ?? item.submissionMethod,
        submittedAt: submission?.submittedAt ?? item.submittedAt,
        // Marks are only ever meaningful for GRADED homework — never shown
        // for CHECKING_ONLY even if a legacy row happens to carry one.
        score: shouldShowMaxMarks(item.homework.assessmentMode) ? (submission?.score ?? item.score) : null,
        maxScore: shouldShowMaxMarks(item.homework.assessmentMode) ? (submission?.maxScore ?? item.maxScore) : null,
        checkedAt: submission?.checkedAt ?? item.checkedAt,
        // teacherRemark is PRIVATE and intentionally never included here —
        // studentFeedback is the only teacher note a student may see. See
        // tests/homework-v2-private-remarks.test.ts.
        studentFeedback: submission?.studentFeedback ?? item.studentFeedback,
        submission: submission ? { ...omitPrivateRemark(submission), attachmentUrl: submissionAttachmentUrl } : null,
        teacher: item.homework.teacher,
        section: item.homework.section,
      };
    }));

    return NextResponse.json({ homework });
  } catch (error) {
    console.error("Error fetching student homework:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
