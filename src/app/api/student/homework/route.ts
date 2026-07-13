import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { resolveManagedOrLegacyUrl } from "@/lib/file-service";

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

    const homework = await Promise.all(statuses.map(async (item) => {
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
        attachmentUrl,
        homeworkStatus: item.homework.status,
        submissionStatus: submission?.submissionStatus ?? item.submissionStatus,
        submissionMethod: submission?.submissionMethod ?? item.submissionMethod,
        submittedAt: submission?.submittedAt ?? item.submittedAt,
        checkedAt: submission?.checkedAt ?? item.checkedAt,
        score: submission?.score ?? item.score,
        maxScore: submission?.maxScore ?? item.maxScore,
        teacherRemark: submission?.teacherRemark ?? item.teacherRemark,
        submission: submission ? { ...submission, attachmentUrl: submissionAttachmentUrl } : null,
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
