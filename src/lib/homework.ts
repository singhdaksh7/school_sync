import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveManagedOrLegacyUrl } from "@/lib/file-service";

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
  /** PRIVATE — never echoed back to a student/guardian route. */
  teacherRemark?: string | null;
  /** Student/guardian-visible feedback (Homework 2.0). */
  studentFeedback?: string | null;
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

  // skipDuplicates guards against a concurrent backfill for the same student
  // (e.g. a duplicate section-transfer event) inserting the same row twice.
  await prisma.homeworkStudentStatus.createMany({
    data: missing.map((h) => ({ homeworkId: h.id, studentId, status: "PENDING" })),
    skipDuplicates: true,
  });
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
  // Excludes soft-deleted teachers so a deactivated account can never create,
  // check, or score homework.
  return prisma.teacher.findFirst({
    where: { userId, isDeleted: false },
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

/**
 * Resolves the managed-file (or legacy URL) attachment for a homework record
 * and each of its submissions, so staff-facing responses never leak a stale
 * signed URL and always prefer the managed file when one exists.
 */
export async function withResolvedAttachments<
  T extends { attachmentUrl?: string | null; attachmentFileId?: string | null; submissions?: unknown[] }
>(homework: T): Promise<T> {
  const submissions = Array.isArray(homework.submissions) ? homework.submissions : [];
  const [attachmentUrl, resolvedSubmissions] = await Promise.all([
    resolveManagedOrLegacyUrl(homework),
    Promise.all(
      submissions.map(async (submission) => ({
        ...(submission as object),
        attachmentUrl: await resolveManagedOrLegacyUrl(submission as { attachmentUrl?: string | null; attachmentFileId?: string | null }),
      }))
    ),
  ]);
  return { ...homework, attachmentUrl, submissions: resolvedSubmissions };
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

// ── Homework 2.0 ─────────────────────────────────────────────────────────────

export type HomeworkAssessmentMode = "CHECKING_ONLY" | "GRADED";
export type HomeworkLifecycleStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "CLOSED" | "CANCELLED";

/**
 * Validates the three homework dates together. Deliberately matches the
 * migration's DB CHECK constraints exactly (permissive "<=", not strict
 * "<"): a homework whose start date and submission deadline are the same
 * instant is a degenerate-but-legal case (also how every pre-2.0 row was
 * backfilled), not an ordering error. This permissive comparison also
 * remains needed for the teacher PATCH/edit path, where dates are
 * updated independently and a caller may legitimately leave them equal.
 * What this rejects is dueDate strictly AFTER deadlineAt — an unambiguous
 * ordering error.
 */
export function validateHomeworkDates(input: {
  dueDate: Date;
  deadlineAt: Date;
  checkingDeadlineAt?: Date | null;
}): string | null {
  if (input.dueDate.getTime() > input.deadlineAt.getTime()) {
    return "Start date/time must be before the submission deadline";
  }
  if (input.checkingDeadlineAt && input.checkingDeadlineAt.getTime() < input.deadlineAt.getTime()) {
    return "Checking deadline cannot be before the submission deadline";
  }
  return null;
}

/**
 * Validates the assessment-mode/maxMarks pair for homework CREATE/EDIT
 * requests. CHECKING_ONLY must never carry a maxMarks value (also enforced
 * at the DB layer); GRADED requires a positive maxMarks — this direction is
 * intentionally an API-layer-only rule (not a DB CHECK) because legacy
 * GRADED homework backfilled by the migration may have a null maxMarks —
 * see the migration's comment for why that is safe and expected.
 */
export function validateAssessmentMode(input: {
  assessmentMode: HomeworkAssessmentMode;
  maxMarks: number | null;
}): string | null {
  if (input.assessmentMode === "CHECKING_ONLY") {
    if (input.maxMarks !== null) return "Checking-only homework must not have maximum marks";
    return null;
  }
  // GRADED
  if (input.maxMarks === null || Number.isNaN(input.maxMarks)) return "Maximum marks is required for graded homework";
  if (input.maxMarks <= 0) return "Maximum marks must be greater than zero";
  return null;
}

/**
 * Validates a single student's marks against the homework's assessment mode
 * and (when known) its maxMarks. CHECKING_ONLY homework must NEVER accept a
 * score from the API, regardless of what a caller supplies — this is the
 * hard boundary between the two assessment modes.
 */
export function validateStudentMarks(input: {
  assessmentMode: HomeworkAssessmentMode;
  homeworkMaxMarks: number | null;
  score: number | null;
}): string | null {
  if (input.assessmentMode === "CHECKING_ONLY") {
    if (input.score !== null) return "Marks cannot be recorded for checking-only homework";
    return null;
  }
  if (input.score === null) return null; // "not checked yet" — always legal, distinct from a checked zero.
  if (Number.isNaN(input.score)) return "Score must be a valid number";
  if (input.score < 0) return "Score cannot be negative";
  if (input.homeworkMaxMarks !== null && input.score > input.homeworkMaxMarks) {
    return `Score cannot exceed the maximum marks (${input.homeworkMaxMarks})`;
  }
  return null;
}

/**
 * Derives whether SCHEDULED homework has crossed into effective visibility,
 * without any client-side timer or durable job — a plain, safe comparison
 * of the persisted status and dueDate (the start/publish instant) against
 * "now". dueDate/deadlineAt are absolute instants (like every other
 * DateTime in this schema), so this comparison is correct regardless of
 * the school's configured timezone: a Date comparison is timezone-agnostic
 * by construction once both sides are absolute instants — the school's
 * timezone only matters when a human TYPES a wall-clock date/time, which
 * happens client-side exactly like the pre-existing dueDate/deadlineAt
 * inputs already did (this introduces no new timezone-handling surface).
 * A durable job was deliberately not used here: there is no action to
 * perform at the transition instant (no email, no side effect) — only a
 * read-time visibility decision, which a stored job can't make any safer
 * or more timely than a direct comparison.
 */
export function getEffectiveHomeworkStatus(
  homework: { status: HomeworkLifecycleStatus; dueDate: Date },
  now: Date = new Date()
): HomeworkLifecycleStatus {
  if (homework.status === "SCHEDULED" && homework.dueDate.getTime() <= now.getTime()) {
    return "ACTIVE";
  }
  return homework.status;
}

/** True once homework is visible to students/guardians (never DRAFT, never SCHEDULED-in-the-future). */
export function isHomeworkVisibleToStudents(
  homework: { status: HomeworkLifecycleStatus; dueDate: Date },
  now: Date = new Date()
): boolean {
  const effective = getEffectiveHomeworkStatus(homework, now);
  return effective === "ACTIVE" || effective === "CLOSED";
}

type PrivateRemarkFields = { teacherRemark?: string | null };

/**
 * Strips teacher-private fields from a record before it is ever sent to a
 * student/guardian-facing API response. This is the ONLY sanctioned way a
 * student/guardian route should shape a HomeworkStudentStatus/
 * HomeworkSubmission-derived object — see
 * tests/homework-v2-private-remarks.test.ts, which asserts teacherRemark
 * never appears in the serialized JSON of any student/guardian route.
 */
export function omitPrivateRemark<T extends PrivateRemarkFields>(record: T): Omit<T, "teacherRemark"> {
  const rest = { ...record };
  delete rest.teacherRemark;
  return rest;
}

/** Marks are only ever meaningful to show once assessmentMode is GRADED. */
export function shouldShowMaxMarks(assessmentMode: HomeworkAssessmentMode): boolean {
  return assessmentMode === "GRADED";
}

// A date field accepts anything parseRequiredDate can turn into a valid
// Date (ISO datetime, a plain "YYYY-MM-DD", etc.) — Zod only checks "this
// is a non-empty string"; the actual Date parsing/validity check happens
// via parseRequiredDate immediately after, exactly like the pre-2.0 route
// already did, so existing client payloads keep working unchanged.
const dateInput = z.string().trim().min(1);

/**
 * Create-homework request shape. `assessmentMode` defaults to
 * CHECKING_ONLY when omitted — a deliberate, documented API-contract
 * narrowing versus the pre-2.0 endpoint (which had no concept of mode and
 * would accept ad-hoc scores on any homework): a request that predates this
 * field gets the SAFER of the two modes (marks refused) rather than
 * silently becoming gradeable. `status` defaults to ACTIVE, preserving the
 * pre-2.0 endpoint's exact behavior for callers that don't opt into
 * draft/scheduled.
 *
 * `deadlineAt` is REQUIRED — deliberately not defaulted to `dueDate`. A
 * homework record with no genuine submission deadline is a data-quality
 * trap (students see no deadline, or a fabricated one), so every new
 * Homework 2.0 record must carry an explicit, teacher-chosen deadline. This
 * is a Homework-2.0-era API-contract change, not a schema/migration change
 * — `deadlineAt` was already NOT NULL. The teacher web UI (the only
 * first-party caller of this endpoint) always sends both dates; there is no
 * external legacy caller of this specific endpoint to preserve compatibility
 * for. The separate admin-created-homework endpoint
 * (/api/schools/[schoolId]/homework) predates Homework 2.0 entirely, never
 * adopted assessmentMode/checkingDeadlineAt, and is intentionally left as
 * the one legacy exception (see its own route file).
 */
export const createHomeworkSchema = z
  .object({
    sectionId: z.string().trim().min(1, "Section is required"),
    subject: z.string().trim().min(1, "Subject is required"),
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().min(1).optional().nullable(),
    dueDate: dateInput,
    deadlineAt: dateInput,
    checkingDeadlineAt: dateInput.optional().nullable(),
    attachmentUrl: z.string().trim().url().optional().nullable(),
    assessmentMode: z.enum(["CHECKING_ONLY", "GRADED"]).default("CHECKING_ONLY"),
    maxMarks: z.number().finite().optional().nullable(),
    status: z.enum(["DRAFT", "SCHEDULED", "ACTIVE"]).default("ACTIVE"),
  })
  .strict();
export type CreateHomeworkInput = z.infer<typeof createHomeworkSchema>;

export const editHomeworkSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional().nullable(),
    attachmentUrl: z.string().trim().url().optional().nullable(),
    dueDate: dateInput.optional(),
    deadlineAt: dateInput.optional(),
    checkingDeadlineAt: dateInput.optional().nullable(),
    assessmentMode: z.enum(["CHECKING_ONLY", "GRADED"]).optional(),
    maxMarks: z.number().finite().optional().nullable(),
    status: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "CLOSED", "CANCELLED"]).optional(),
    sectionId: z.string().trim().min(1).optional(),
    subject: z.string().trim().min(1).optional(),
  })
  .strict();
export type EditHomeworkInput = z.infer<typeof editHomeworkSchema>;

/** Legal status transitions for the teacher-facing PATCH endpoint — never a bare enum-membership check. */
const ALLOWED_STATUS_TRANSITIONS: Record<HomeworkLifecycleStatus, HomeworkLifecycleStatus[]> = {
  DRAFT: ["DRAFT", "SCHEDULED", "ACTIVE", "CANCELLED"],
  SCHEDULED: ["SCHEDULED", "ACTIVE", "CANCELLED"],
  ACTIVE: ["ACTIVE", "CLOSED", "CANCELLED"],
  CLOSED: ["CLOSED"],
  CANCELLED: ["CANCELLED"],
};

export function validateStatusTransition(from: HomeworkLifecycleStatus, to: HomeworkLifecycleStatus): string | null {
  if (!ALLOWED_STATUS_TRANSITIONS[from]?.includes(to)) {
    return `Cannot move homework from ${from} to ${to}`;
  }
  return null;
}
