import { prisma } from "@/lib/prisma";

export type HomeworkStudentStatusInput = {
  studentId: string;
  status: "PENDING" | "SUBMITTED" | "NOT_SUBMITTED" | "LATE" | "CHECKED";
  submittedAt?: string | null;
  score?: number | string | null;
  maxScore?: number | string | null;
  teacherRemark?: string | null;
  parentVisible?: boolean;
};

export function normalizeSubject(subject: unknown) {
  return typeof subject === "string" ? subject.trim() : "";
}

export function parseRequiredDate(value: unknown) {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function getTeacherByUserId(userId: string) {
  return prisma.teacher.findUnique({
    where: { userId },
    select: {
      id: true,
      schoolId: true,
      subject: true,
      mentorSectionId: true,
    },
  });
}

export async function getTeacherAssignments(teacherId: string, schoolId: string) {
  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId },
    select: {
      subject: true,
      timetableSlots: {
        where: { schoolId },
        include: {
          section: {
            include: {
              class: { select: { id: true, name: true } },
              students: {
                orderBy: { rollNo: "asc" },
                select: { id: true, name: true, rollNo: true },
              },
            },
          },
        },
      },
    },
  });
  if (!teacher) return [];

  const map = new Map<string, {
    sectionId: string;
    sectionName: string;
    className: string;
    subject: string;
    students: { id: string; name: string; rollNo: string }[];
  }>();

  for (const slot of teacher.timetableSlots) {
    const subject = normalizeSubject(slot.subject || teacher.subject);
    if (!subject) continue;
    const key = `${slot.sectionId}|${subject.toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        sectionId: slot.sectionId,
        sectionName: slot.section.name,
        className: slot.section.class.name,
        subject,
        students: slot.section.students,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    `${a.className}-${a.sectionName}-${a.subject}`.localeCompare(`${b.className}-${b.sectionName}-${b.subject}`)
  );
}

export async function teacherCanTeachSubjectSection(
  teacherId: string,
  schoolId: string,
  sectionId: string,
  subject: string
) {
  const normalized = normalizeSubject(subject);
  if (!normalized) return false;
  const assignments = await getTeacherAssignments(teacherId, schoolId);
  return assignments.some(
    (assignment) =>
      assignment.sectionId === sectionId &&
      assignment.subject.toLowerCase() === normalized.toLowerCase()
  );
}

export async function getHomeworkForTeacherAccess(homeworkId: string, teacherId: string, schoolId: string) {
  const homework = await prisma.homework.findFirst({
    where: { id: homeworkId, schoolId },
    include: {
      section: { include: { class: { select: { name: true } } } },
      teacher: { select: { id: true, name: true, subject: true } },
      studentStatuses: {
        include: {
          student: {
            select: { id: true, name: true, rollNo: true, sectionId: true, schoolId: true },
          },
        },
        orderBy: { student: { rollNo: "asc" } },
      },
    },
  });
  if (!homework) return null;
  if (homework.teacherId === teacherId) return homework;

  const canTeach = await teacherCanTeachSubjectSection(teacherId, schoolId, homework.sectionId, homework.subject);
  return canTeach ? homework : null;
}

export async function validateHomeworkTeacherAssignment(
  schoolId: string,
  teacherId: string,
  sectionId: string,
  subject: string
) {
  const [teacher, section, canTeach] = await Promise.all([
    prisma.teacher.findFirst({ where: { id: teacherId, schoolId }, select: { id: true } }),
    prisma.section.findFirst({ where: { id: sectionId, class: { schoolId } }, select: { id: true } }),
    teacherCanTeachSubjectSection(teacherId, schoolId, sectionId, subject),
  ]);

  if (!teacher) return "Teacher not found in this school";
  if (!section) return "Section not found in this school";
  if (!canTeach) return "Teacher is not assigned to teach this subject in this section";
  return null;
}

export function validateScore(score: number | null, maxScore: number | null) {
  if (Number.isNaN(score) || Number.isNaN(maxScore)) return "Score and max score must be valid numbers";
  if (score !== null && score < 0) return "Score cannot be negative";
  if (maxScore !== null && maxScore < 0) return "Max score cannot be negative";
  if (score !== null && maxScore !== null && score > maxScore) return "Score cannot exceed max score";
  return null;
}

export function homeworkIncludeForList() {
  return {
    section: { include: { class: { select: { id: true, name: true } } } },
    teacher: { select: { id: true, name: true, subject: true } },
    studentStatuses: {
      include: {
        student: { select: { id: true, name: true, rollNo: true, sectionId: true } },
      },
      orderBy: { student: { rollNo: "asc" } },
    },
  } as const;
}
