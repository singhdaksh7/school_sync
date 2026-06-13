import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const studentId = req.nextUrl.searchParams.get("studentId");
    if (studentId && !(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const linkedStudents = await prisma.student.findMany({
      where: {
        schoolId: auth.guardian.schoolId,
        ...(studentId ? { id: studentId } : {}),
        guardianLinks: {
          some: {
            guardianId: auth.guardian.id,
            schoolId: auth.guardian.schoolId,
          },
        },
      },
      select: { id: true },
    });
    const studentIds = linkedStudents.map((student) => student.id);

    const statuses = studentIds.length
      ? await prisma.homeworkStudentStatus.findMany({
          where: {
            parentVisible: true,
            studentId: { in: studentIds },
            student: { schoolId: auth.guardian.schoolId },
            homework: {
              schoolId: auth.guardian.schoolId,
              status: { not: "CANCELLED" },
            },
          },
          include: {
            student: {
              select: {
                id: true,
                name: true,
                rollNo: true,
                section: { include: { class: { select: { name: true } } } },
              },
            },
            homework: {
              include: {
                teacher: { select: { id: true, name: true } },
                section: { include: { class: { select: { name: true } } } },
                submissions: {
                  where: {
                    studentId: { in: studentIds },
                    schoolId: auth.guardian.schoolId,
                  },
                },
              },
            },
          },
          orderBy: [{ homework: { dueDate: "asc" } }, { createdAt: "desc" }],
        })
      : [];

    const homework = statuses.map((item) => {
      const submission = item.homework.submissions.find((submitted) => submitted.studentId === item.studentId) || null;
      return {
      id: item.id,
      homeworkId: item.homeworkId,
      studentId: item.studentId,
      student: item.student,
      title: item.homework.title,
      description: item.homework.description,
      subject: item.homework.subject,
      dueDate: item.homework.dueDate,
      attachmentUrl: item.homework.attachmentUrl,
      homeworkStatus: item.homework.status,
      submissionStatus: submission?.status ?? item.status,
      submittedAt: submission?.submittedAt ?? item.submittedAt,
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
    console.error("Error fetching parent homework:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
