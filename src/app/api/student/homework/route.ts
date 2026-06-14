import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentMobileAuth } from "@/lib/student-mobile-auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentMobileAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    const homework = statuses.map((item) => {
      const submission = item.homework.submissions.find((s) => s.studentId === item.studentId) || null;
      return {
        id: item.id,
        homeworkId: item.homeworkId,
        studentId: item.studentId,
        title: item.homework.title,
        description: item.homework.description,
        subject: item.homework.subject,
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
