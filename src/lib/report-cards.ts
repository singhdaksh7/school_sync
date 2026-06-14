import { prisma } from "@/lib/prisma";

export function gradeForPercentage(percentage: number) {
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B+";
  if (percentage >= 60) return "B";
  if (percentage >= 50) return "C";
  if (percentage >= 40) return "D";
  return "E";
}

export function parseAttendanceSummary(value: string) {
  try {
    return JSON.parse(value) as {
      totalDays: number;
      presentDays: number;
      absentDays: number;
      lateDays: number;
      percentage: number | null;
    };
  } catch {
    return { totalDays: 0, presentDays: 0, absentDays: 0, lateDays: 0, percentage: null };
  }
}

export async function getTeacherForSession(userId: string) {
  return prisma.teacher.findUnique({
    where: { userId },
    include: {
      school: { select: { id: true, name: true, logoUrl: true } },
      mentorSection: {
        include: {
          class: { select: { id: true, name: true } },
          students: {
            orderBy: { rollNo: "asc" },
            select: { id: true, name: true, rollNo: true, sectionId: true, schoolId: true },
          },
        },
      },
    },
  });
}

export async function generateReportCardForStudent(input: {
  schoolId: string;
  teacherId: string;
  sectionId: string;
  examSchemeId: string;
  studentId: string;
  classTeacherRemark?: string | null;
}) {
  const [student, scheme, attendances, examResults] = await Promise.all([
    prisma.student.findFirst({
      where: { id: input.studentId, schoolId: input.schoolId, sectionId: input.sectionId },
      select: { id: true },
    }),
    prisma.examScheme.findFirst({
      where: { id: input.examSchemeId, schoolId: input.schoolId },
      include: { exams: { orderBy: { order: "asc" } } },
    }),
    prisma.attendance.findMany({
      where: { schoolId: input.schoolId, studentId: input.studentId },
      select: { status: true },
    }),
    prisma.examResult.findMany({
      where: {
        studentId: input.studentId,
        student: { schoolId: input.schoolId, sectionId: input.sectionId },
        exam: { schemeId: input.examSchemeId, scheme: { schoolId: input.schoolId } },
      },
      include: { exam: { select: { id: true, name: true, maxMarks: true, order: true } } },
      orderBy: { exam: { order: "asc" } },
    }),
  ]);

  if (!student || !scheme) return null;

  const publishedCard = await prisma.reportCard.findFirst({
    where: {
      studentId: input.studentId,
      examSchemeId: input.examSchemeId,
      schoolId: input.schoolId,
      sectionId: input.sectionId,
      status: "PUBLISHED",
    },
    include: reportCardInclude,
  });
  if (publishedCard) return publishedCard;

  const resultByExamId = new Map(examResults.map((result) => [result.examId, result]));
  const subjects = scheme.exams.map((exam) => {
    const result = resultByExamId.get(exam.id);
    const marks = result?.marks ?? 0;
    const percentage = exam.maxMarks > 0 ? (marks / exam.maxMarks) * 100 : 0;
    return {
      subject: exam.name,
      marks,
      maxMarks: exam.maxMarks,
      grade: gradeForPercentage(percentage),
    };
  });

  const totalMarks = subjects.reduce((sum, subject) => sum + subject.marks, 0);
  const totalMax = subjects.reduce((sum, subject) => sum + subject.maxMarks, 0);
  const percentage = totalMax > 0 ? Number(((totalMarks / totalMax) * 100).toFixed(2)) : 0;
  const presentDays = attendances.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const lateDays = attendances.filter((a) => a.status === "LATE").length;
  const absentDays = attendances.filter((a) => a.status === "ABSENT").length;
  const attendanceSummary = {
    totalDays: attendances.length,
    presentDays,
    absentDays,
    lateDays,
    percentage: attendances.length > 0 ? Math.round((presentDays / attendances.length) * 100) : null,
  };

  const card = await prisma.reportCard.upsert({
    where: { studentId_examSchemeId: { studentId: input.studentId, examSchemeId: input.examSchemeId } },
    create: {
      schoolId: input.schoolId,
      studentId: input.studentId,
      sectionId: input.sectionId,
      examSchemeId: input.examSchemeId,
      generatedByTeacherId: input.teacherId,
      status: "DRAFT",
      classTeacherRemark: input.classTeacherRemark?.trim() || null,
      attendanceSummary: JSON.stringify(attendanceSummary),
      totalMarks,
      percentage,
      grade: gradeForPercentage(percentage),
      subjects: { create: subjects },
    },
    update: {
      sectionId: input.sectionId,
      generatedByTeacherId: input.teacherId,
      status: "DRAFT",
      publishedAt: null,
      classTeacherRemark: input.classTeacherRemark?.trim() || null,
      attendanceSummary: JSON.stringify(attendanceSummary),
      totalMarks,
      percentage,
      grade: gradeForPercentage(percentage),
      subjects: {
        deleteMany: {},
        create: subjects,
      },
    },
    include: reportCardInclude,
  });

  return card;
}

export const reportCardInclude = {
  school: { select: { id: true, name: true, logoUrl: true } },
  student: {
    select: {
      id: true,
      name: true,
      rollNo: true,
      section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
    },
  },
  examScheme: { select: { id: true, name: true } },
  generatedByTeacher: { select: { id: true, name: true } },
  subjects: { orderBy: { subject: "asc" } },
} as const;

export function serializeReportCard<T extends { attendanceSummary: string }>(card: T) {
  return {
    ...card,
    attendanceSummary: parseAttendanceSummary(card.attendanceSummary),
  };
}
