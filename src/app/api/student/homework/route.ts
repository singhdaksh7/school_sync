import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.log(`[HW_DEBUG] fetching homework for studentId=${auth.studentId} schoolId=${auth.schoolId} sectionId=${auth.sectionId}`);

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
    console.log(`[HW_DEBUG] query returned ${statuses.length} HomeworkStudentStatus row(s) for studentId=${auth.studentId}`);

    const homework = statuses.map((item) => {
      const submission = item.homework.submissions.find((s) => s.studentId === item.studentId) || null;
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
        attachmentUrl: item.homework.attachmentUrl,
        homeworkStatus: item.homework.status,
        submissionStatus: submission?.submissionStatus ?? item.submissionStatus,
        submissionMethod: submission?.submissionMethod ?? item.submissionMethod,
        submittedAt: submission?.submittedAt ?? item.submittedAt,
        checkedAt: submission?.checkedAt ?? item.checkedAt,
        score: submission?.score ?? item.score,
        maxScore: submission?.maxScore ?? item.maxScore,
        teacherRemark: submission?.teacherRemark ?? item.teacherRemark,
        submission,
        teacher: item.homework.teacher,
        section: item.homework.section,
      };
    });

    return NextResponse.json({ homework });
  } catch (error) {
    console.error("Error fetching student homework:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
