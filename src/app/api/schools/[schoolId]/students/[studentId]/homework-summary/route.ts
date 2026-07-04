import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import {
  addHomeworkStatsRecord as addRecord,
  createHomeworkStatsAccumulator as createAccumulator,
  homeworkStatsToResponse as toResponse,
  type HomeworkStatsAccumulator,
} from "@/lib/homework";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; studentId: string }> }
) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "HOMEWORK");
    if (denied) return denied;
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    select: {
      id: true,
      name: true,
      rollNo: true,
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const records = await prisma.homeworkStudentStatus.findMany({
    where: {
      studentId,
      student: { schoolId },
      homework: { schoolId, status: { not: "CANCELLED" } },
    },
    include: {
      homework: {
        select: {
          id: true,
          title: true,
          subject: true,
          deadlineAt: true,
          dueDate: true,
          status: true,
          teacher: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { homework: { deadlineAt: "desc" } }],
  });

  const total = createAccumulator();
  const subjectMap = new Map<string, HomeworkStatsAccumulator>();

  for (const record of records) {
    addRecord(total, record.submissionStatus, record.submissionMethod, record.score, record.maxScore);
    const subjectSummary = subjectMap.get(record.homework.subject) ?? createAccumulator();
    addRecord(subjectSummary, record.submissionStatus, record.submissionMethod, record.score, record.maxScore);
    subjectMap.set(record.homework.subject, subjectSummary);
  }

  const subjectWiseSummary = Array.from(subjectMap.entries())
    .map(([subject, summary]) => ({ subject, ...toResponse(summary) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  const recentHomeworkRecords = records.slice(0, 10).map((record) => ({
    id: record.id,
    homeworkId: record.homeworkId,
    title: record.homework.title,
    subject: record.homework.subject,
    deadlineAt: record.homework.deadlineAt,
    dueDate: record.homework.dueDate,
    homeworkStatus: record.homework.status,
    submissionStatus: record.submissionStatus,
    submissionMethod: record.submissionMethod,
    submittedAt: record.submittedAt,
    checkedAt: record.checkedAt,
    score: record.score,
    maxScore: record.maxScore,
    teacherRemark: record.teacherRemark,
    teacher: record.homework.teacher,
  }));

  return NextResponse.json({
    student,
    ...toResponse(total),
    subjectWiseSummary,
    recentHomeworkRecords,
  });
}
