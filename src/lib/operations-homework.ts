/**
 * School Operations Command Center — homework today insights (PART 15).
 * `pendingReview` counts HomeworkSubmission rows not yet REVIEWED/REJECTED
 * (i.e. SUBMITTED or LATE) — distinct from students who never submitted at
 * all (HomeworkStudentStatus), which is a separate, already-existing concept
 * not duplicated here.
 */

import { prisma } from "@/lib/prisma";

export interface HomeworkTodaySummary {
  createdToday: number;
  dueToday: number;
  overdue: number;
  submissionsToday: number;
  pendingReview: number;
  scoredToday: number;
}

export interface PendingReviewGroup {
  homeworkId: string;
  title: string;
  subject: string;
  sectionName: string;
  className: string;
  pendingCount: number;
}

const TOP_PENDING_REVIEW_LIMIT = 5;
const PENDING_REVIEW_STATUSES = ["SUBMITTED", "LATE"] as const;

function nextDay(d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n;
}

export async function computeHomeworkTodaySummary(schoolId: string, dateOnly: Date, now: Date): Promise<HomeworkTodaySummary> {
  const tomorrow = nextDay(dateOnly);

  const [createdToday, dueToday, overdue, submissionsToday, pendingReview, scoredToday] = await Promise.all([
    prisma.homework.count({ where: { schoolId, createdAt: { gte: dateOnly, lt: tomorrow } } }),
    prisma.homework.count({ where: { schoolId, dueDate: { gte: dateOnly, lt: tomorrow } } }),
    prisma.homework.count({ where: { schoolId, status: "ACTIVE", deadlineAt: { lt: now } } }),
    prisma.homeworkSubmission.count({ where: { schoolId, submittedAt: { gte: dateOnly, lt: tomorrow } } }),
    prisma.homeworkSubmission.count({ where: { schoolId, status: { in: [...PENDING_REVIEW_STATUSES] } } }),
    prisma.homeworkSubmission.count({ where: { schoolId, reviewedAt: { gte: dateOnly, lt: tomorrow } } }),
  ]);

  return { createdToday, dueToday, overdue, submissionsToday, pendingReview, scoredToday };
}

export async function topPendingReviewGroups(schoolId: string, limit = TOP_PENDING_REVIEW_LIMIT): Promise<PendingReviewGroup[]> {
  const grouped = await prisma.homeworkSubmission.groupBy({
    by: ["homeworkId"],
    where: { schoolId, status: { in: [...PENDING_REVIEW_STATUSES] } },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];

  const sorted = grouped
    .sort((a, b) => b._count._all - a._count._all || a.homeworkId.localeCompare(b.homeworkId))
    .slice(0, limit);

  const homeworkRows = await prisma.homework.findMany({
    where: { id: { in: sorted.map((g) => g.homeworkId) } },
    select: { id: true, title: true, subject: true, section: { select: { name: true, class: { select: { name: true } } } } },
  });
  const byId = new Map(homeworkRows.map((h) => [h.id, h]));

  const results: PendingReviewGroup[] = [];
  for (const g of sorted) {
    const hw = byId.get(g.homeworkId);
    if (!hw) continue;
    results.push({
      homeworkId: g.homeworkId,
      title: hw.title,
      subject: hw.subject,
      sectionName: hw.section.name,
      className: hw.section.class.name,
      pendingCount: g._count._all,
    });
  }
  return results;
}
