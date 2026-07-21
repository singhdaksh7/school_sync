import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import {
  addHomeworkStatsRecord,
  createHomeworkStatsAccumulator,
  getTeacherByUserId,
  homeworkStatsToResponse,
  normalizeSubject,
  teacherCanTeachSubjectSection,
  type HomeworkStatsAccumulator,
} from "@/lib/homework";
import { compareStudentsByRollNumber } from "@/lib/student-ordering";

type AcademicStatus = "PENDING" | "SUBMITTED" | "LATE_SUBMITTED" | "NOT_SUBMITTED" | "CHECKED" | "REJECTED";

function isCompleted(status: AcademicStatus) {
  return status === "SUBMITTED" || status === "LATE_SUBMITTED" || status === "CHECKED";
}

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  const subject = normalizeSubject(searchParams.get("subject"));
  if (!sectionId || !subject) {
    return NextResponse.json({ error: "sectionId and subject are required" }, { status: 400 });
  }

  const canTeach = await teacherCanTeachSubjectSection(teacher.id, teacher.schoolId, sectionId, subject);
  if (!canTeach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const records = await prisma.homeworkStudentStatus.findMany({
    where: {
      student: { schoolId: teacher.schoolId, sectionId },
      homework: { schoolId: teacher.schoolId, sectionId, subject: { equals: subject, mode: "insensitive" }, status: { not: "CANCELLED" } },
    },
    include: {
      student: { select: { id: true, name: true, rollNo: true } },
      homework: { select: { id: true, title: true, subject: true, deadlineAt: true } },
    },
    orderBy: [{ student: { rollNo: "asc" } }, { homework: { deadlineAt: "desc" } }],
  });

  const studentAccumulators = new Map<string, { name: string; rollNo: string; acc: HomeworkStatsAccumulator }>();
  const history: {
    id: string;
    homeworkId: string;
    studentId: string;
    studentName: string;
    rollNo: string;
    subject: string;
    title: string;
    deadlineAt: Date;
    completed: boolean;
  }[] = [];

  for (const record of records) {
    const entry = studentAccumulators.get(record.studentId) ?? {
      name: record.student.name,
      rollNo: record.student.rollNo,
      acc: createHomeworkStatsAccumulator(),
    };
    addHomeworkStatsRecord(entry.acc, record.submissionStatus, record.submissionMethod, record.score, record.maxScore);
    studentAccumulators.set(record.studentId, entry);

    history.push({
      id: record.id,
      homeworkId: record.homeworkId,
      studentId: record.studentId,
      studentName: record.student.name,
      rollNo: record.student.rollNo,
      subject: record.homework.subject,
      title: record.homework.title,
      deadlineAt: record.homework.deadlineAt,
      completed: isCompleted(record.submissionStatus),
    });
  }

  // Include students with zero homework records yet (newly added to the section).
  const allStudents = await prisma.student.findMany({
    where: { schoolId: teacher.schoolId, sectionId },
    select: { id: true, name: true, rollNo: true },
    orderBy: { rollNo: "asc" },
  });
  for (const student of allStudents) {
    if (!studentAccumulators.has(student.id)) {
      studentAccumulators.set(student.id, { name: student.name, rollNo: student.rollNo, acc: createHomeworkStatsAccumulator() });
    }
  }

  // Universal roll-number ordering (canonical comparator — see /lib/student-ordering)
  // replaces the previous one-off `localeCompare(..., { numeric: true })`, which didn't
  // implement the full rule set (stable leading-zero tiebreak, null/empty-last, etc).
  const students = Array.from(studentAccumulators.entries())
    .map(([studentId, entry]) => ({
      studentId,
      name: entry.name,
      rollNo: entry.rollNo,
      ...homeworkStatsToResponse(entry.acc),
    }))
    .sort((a, b) => compareStudentsByRollNumber({ ...a, id: a.studentId }, { ...b, id: b.studentId }));

  const withPercentage = students.filter((s) => s.completionPercentage !== null);
  const averagePercentage = withPercentage.length > 0
    ? Math.round((withPercentage.reduce((sum, s) => sum + (s.completionPercentage ?? 0), 0) / withPercentage.length) * 100) / 100
    : null;
  const above90 = withPercentage.filter((s) => (s.completionPercentage ?? 0) > 90);
  const below70 = withPercentage.filter((s) => (s.completionPercentage ?? 0) < 70);
  const mostConsistent = [...withPercentage].sort((a, b) => (b.completionPercentage ?? 0) - (a.completionPercentage ?? 0)).slice(0, 5);
  const needsAttention = [...below70].sort((a, b) => (a.completionPercentage ?? 0) - (b.completionPercentage ?? 0)).slice(0, 5);

  const totalHomeworkAssigned = new Set(history.map((h) => h.homeworkId)).size;

  return NextResponse.json({
    students,
    history,
    summary: {
      totalHomeworkAssigned,
      averagePercentage,
      above90Count: above90.length,
      below70Count: below70.length,
      mostConsistent: mostConsistent.map((s) => ({ studentId: s.studentId, name: s.name, percentage: s.completionPercentage })),
      needsAttention: needsAttention.map((s) => ({ studentId: s.studentId, name: s.name, percentage: s.completionPercentage })),
    },
  });
}
