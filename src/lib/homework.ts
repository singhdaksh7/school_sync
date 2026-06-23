import { prisma } from "@/lib/prisma";

const DEFAULT_EXAM_MILESTONES = ["UT-1", "UT-2", "Half Yearly", "UT-3", "UT-4", "Final Exam"];

export type AcademicStatus = "PENDING" | "SUBMITTED" | "LATE_SUBMITTED" | "NOT_SUBMITTED" | "CHECKED" | "REJECTED";
type SubmissionMethod = "NONE" | "ONLINE" | "PHYSICAL";

export type HomeworkStatsAccumulator = {
  totalAssigned: number;
  submittedCount: number;
  onlineSubmittedCount: number;
  physicalSubmittedCount: number;
  lateSubmittedCount: number;
  notSubmittedCount: number;
  checkedCount: number;
  scoredPercentages: number[];
};

export function createHomeworkStatsAccumulator(): HomeworkStatsAccumulator {
  return {
    totalAssigned: 0,
    submittedCount: 0,
    onlineSubmittedCount: 0,
    physicalSubmittedCount: 0,
    lateSubmittedCount: 0,
    notSubmittedCount: 0,
    checkedCount: 0,
    scoredPercentages: [],
  };
}

function roundPercentage(value: number) {
  return Math.round(value * 100) / 100;
}

function averageScore(scoredPercentages: number[]) {
  if (scoredPercentages.length === 0) return null;
  return roundPercentage(scoredPercentages.reduce((sum, score) => sum + score, 0) / scoredPercentages.length);
}

export function addHomeworkStatsRecord(
  summary: HomeworkStatsAccumulator,
  status: AcademicStatus,
  method: SubmissionMethod,
  score: number | null,
  maxScore: number | null
) {
  summary.totalAssigned += 1;

  if (status === "SUBMITTED" || status === "LATE_SUBMITTED" || status === "CHECKED") {
    summary.submittedCount += 1;
  }
  if (method === "ONLINE" && status !== "PENDING" && status !== "NOT_SUBMITTED") {
    summary.onlineSubmittedCount += 1;
  }
  if (method === "PHYSICAL" && status !== "PENDING" && status !== "NOT_SUBMITTED") {
    summary.physicalSubmittedCount += 1;
  }
  if (status === "LATE_SUBMITTED") summary.lateSubmittedCount += 1;
  if (status === "NOT_SUBMITTED") summary.notSubmittedCount += 1;
  if (status === "CHECKED") summary.checkedCount += 1;
  if (score !== null && maxScore !== null && maxScore > 0) {
    summary.scoredPercentages.push((score / maxScore) * 100);
  }
}

export function homeworkStatsToResponse(summary: HomeworkStatsAccumulator) {
  const completedCount = summary.submittedCount;
  const completionPercentage = summary.totalAssigned > 0
    ? roundPercentage((completedCount / summary.totalAssigned) * 100)
    : null;
  return {
    totalAssigned: summary.totalAssigned,
    submittedCount: summary.submittedCount,
    onlineSubmittedCount: summary.onlineSubmittedCount,
    physicalSubmittedCount: summary.physicalSubmittedCount,
    lateSubmittedCount: summary.lateSubmittedCount,
    notSubmittedCount: summary.notSubmittedCount,
    checkedCount: summary.checkedCount,
    completedCount,
    missedCount: summary.notSubmittedCount,
    completionPercentage,
    averageScore: averageScore(summary.scoredPercentages),
  };
}

/** Seeds the default exam milestone set for a school the first time it's accessed. */
export async function ensureDefaultExamMilestonesSeeded(schoolId: string) {
  const existingCount = await prisma.examMilestone.count({ where: { schoolId } });
  if (existingCount === 0) {
    await prisma.examMilestone.createMany({
      data: DEFAULT_EXAM_MILESTONES.map((name, index) => ({ schoolId, name, sequence: index, active: true })),
    });
  }
}

/** Returns this school's active exam milestones, lazy-seeding the default set on first use. */
export async function getActiveExamMilestones(schoolId: string) {
  await ensureDefaultExamMilestonesSeeded(schoolId);
  return prisma.examMilestone.findMany({
    where: { schoolId, active: true },
    orderBy: { sequence: "asc" },
  });
}

export type HomeworkStudentStatusInput = {
  studentId: string;
  status: "PENDING" | "SUBMITTED" | "NOT_SUBMITTED" | "LATE" | "CHECKED" | "REJECTED";
  submissionMethod?: "NONE" | "ONLINE" | "PHYSICAL";
  submittedAt?: string | null;
  score?: number | string | null;
  maxScore?: number | string | null;
  teacherRemark?: string | null;
  parentVisible?: boolean;
};

export function normalizeSubject(subject: unknown) {
  return typeof subject === "string" ? subject.trim() : "";
}

/**
 * HomeworkStudentStatus rows are a one-time snapshot taken when homework is
 * created (see POST /api/teacher/homework) — a student who wasn't in the
 * section at that exact moment (added later, transferred in, or the section
 * was empty when the homework was assigned) never gets a row and silently
 * never sees that homework, no matter how many times they refresh. Call this
 * after any event that puts a student into a section, to backfill rows for
 * every non-cancelled homework already assigned to that section.
 */
export async function backfillHomeworkStatusForStudent(studentId: string, schoolId: string, sectionId: string) {
  const homework = await prisma.homework.findMany({
    where: { schoolId, sectionId, status: { not: "CANCELLED" } },
    select: { id: true },
  });
  if (homework.length === 0) return;

  const existing = await prisma.homeworkStudentStatus.findMany({
    where: { studentId, homeworkId: { in: homework.map((h) => h.id) } },
    select: { homeworkId: true },
  });
  const covered = new Set(existing.map((e) => e.homeworkId));
  const missing = homework.filter((h) => !covered.has(h.id));
  if (missing.length === 0) return;

  await prisma.homeworkStudentStatus.createMany({
    data: missing.map((h) => ({ homeworkId: h.id, studentId, status: "PENDING" })),
    skipDuplicates: true,
  });
  console.log(`[HW_DEBUG] backfilled ${missing.length} HomeworkStudentStatus row(s) for studentId=${studentId} sectionId=${sectionId}`);
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

const STUDENT_SELECT = {
  orderBy: { rollNo: "asc" as const },
  select: { id: true, name: true, rollNo: true },
};

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
              students: STUDENT_SELECT,
            },
          },
        },
      },
      mentorSection: {
        include: {
          class: { select: { id: true, name: true } },
          students: STUDENT_SELECT,
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

  // A class mentor can manage homework/marks/notebook checking for their
  // mentor section even without a matching timetable slot — falls back to
  // "General" when the teacher has no subject set, so the assignment always
  // shows up once a mentor section is assigned.
  if (teacher.mentorSection) {
    const subject = normalizeSubject(teacher.subject) || "General";
    const key = `${teacher.mentorSection.id}|${subject.toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        sectionId: teacher.mentorSection.id,
        sectionName: teacher.mentorSection.name,
        className: teacher.mentorSection.class.name,
        subject,
        students: teacher.mentorSection.students,
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
      submissions: {
        include: {
          student: { select: { id: true, name: true, rollNo: true, sectionId: true, schoolId: true } },
          guardian: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { submittedAt: "desc" },
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
    submissions: {
      include: {
        student: { select: { id: true, name: true, rollNo: true, sectionId: true } },
        guardian: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { submittedAt: "desc" },
    },
  } as const;
}
