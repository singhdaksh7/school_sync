import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  gradeFromBands,
  normalizeSnapshot,
  parseGradeBands,
  resolveTemplateForReportCard,
  templateToSnapshot,
} from "@/lib/report-card-templates";

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
  const [student, scheme, attendances, examResults, section] = await Promise.all([
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
    prisma.section.findFirst({
      where: { id: input.sectionId, class: { schoolId: input.schoolId } },
      select: { classId: true },
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

  // Phase 8: pick a template (class-assigned → school default → none) so the
  // report card can capture an immutable snapshot of branding/layout/grading.
  const template = await resolveTemplateForReportCard({
    schoolId: input.schoolId,
    classId: section?.classId ?? null,
  });
  const gradeBands = template ? parseGradeBands(template.gradeBands) : null;
  const gradeFor = (pct: number) =>
    gradeBands && gradeBands.length > 0 ? gradeFromBands(pct, gradeBands) : gradeForPercentage(pct);

  const resultByExamId = new Map(examResults.map((result) => [result.examId, result]));
  const subjects = scheme.exams.map((exam) => {
    const result = resultByExamId.get(exam.id);
    const marks = result?.marks ?? 0;
    const percentage = exam.maxMarks > 0 ? (marks / exam.maxMarks) * 100 : 0;
    return {
      subject: exam.name,
      marks,
      maxMarks: exam.maxMarks,
      grade: gradeFor(percentage),
    };
  });

  const totalMarks = subjects.reduce((sum, subject) => sum + subject.marks, 0);
  const totalMax = subjects.reduce((sum, subject) => sum + subject.maxMarks, 0);
  const percentage = totalMax > 0 ? Number(((totalMarks / totalMax) * 100).toFixed(2)) : 0;
  const templateId = template?.id ?? null;
  const templateSnapshot = template ? templateToSnapshot(template) : null;
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
      grade: gradeFor(percentage),
      templateId,
      templateSnapshot: templateSnapshot ?? Prisma.DbNull,
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
      grade: gradeFor(percentage),
      templateId,
      templateSnapshot: templateSnapshot ?? Prisma.DbNull,
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

type CardForPdf = {
  school: { name: string; logoUrl: string | null };
  student: { name: string; rollNo: string; section: { name: string; class: { name: string } } };
  examScheme: { name: string };
  generatedByTeacher: { name: string };
  subjects: { subject: string; marks: number; maxMarks: number; grade: string; subjectTeacherRemark?: string | null }[];
  totalMarks: number;
  percentage: number;
  grade: string;
  attendanceSummary: string;
  classTeacherRemark: string | null;
  publishedAt: Date | null;
  templateSnapshot: unknown;
};

/**
 * Build the input for {@link generateReportCardPdf} from a stored report card.
 * Honors the immutable templateSnapshot when present; otherwise the PDF falls
 * back to the default layout (templateSnapshot === null) — this is what keeps
 * already-published cards stable when a template is later edited.
 */
export function reportCardToPdfInput(card: CardForPdf) {
  const snapshot = normalizeSnapshot(card.templateSnapshot);
  return {
    schoolName: card.school.name,
    logoUrl: card.school.logoUrl,
    studentName: card.student.name,
    rollNo: card.student.rollNo,
    classSection: `${card.student.section.class.name}-${card.student.section.name}`,
    examName: card.examScheme.name,
    subjects: card.subjects,
    totalMarks: card.totalMarks,
    percentage: card.percentage,
    grade: card.grade,
    attendance: parseAttendanceSummary(card.attendanceSummary),
    classTeacherRemark: card.classTeacherRemark,
    generatedBy: card.generatedByTeacher.name,
    publishedAt: card.publishedAt?.toISOString() ?? null,
    template: snapshot,
  };
}
