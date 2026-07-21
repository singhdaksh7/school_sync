import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import type { TrendPoint } from "@/components/charts/TrendBarChart";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function lastNMonths(n: number) {
  const now = new Date();
  const months: { key: string; label: string; start: Date; end: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    months.push({ key: monthKey(start), label: format(start, "MMM yy"), start, end });
  }
  return months;
}

function bucketCounts(dates: Date[], months: ReturnType<typeof lastNMonths>): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(monthKey(d), (counts.get(monthKey(d)) ?? 0) + 1);
  return months.map((m) => ({ label: m.label, value: counts.get(m.key) ?? 0 }));
}

function bucketSums(rows: { date: Date; amount: number }[], months: ReturnType<typeof lastNMonths>): TrendPoint[] {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(monthKey(r.date), (sums.get(monthKey(r.date)) ?? 0) + r.amount);
  return months.map((m) => ({ label: m.label, value: Math.round(sums.get(m.key) ?? 0) }));
}

const COMPLETED_HOMEWORK_STATUSES = new Set(["SUBMITTED", "CHECKED"]);

function bucketHomeworkCompletion(
  rows: { status: string; dueDate: Date }[],
  months: ReturnType<typeof lastNMonths>
): TrendPoint[] {
  const totals = new Map<string, { total: number; completed: number }>();
  for (const r of rows) {
    const k = monthKey(r.dueDate);
    const entry = totals.get(k) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (COMPLETED_HOMEWORK_STATUSES.has(r.status)) entry.completed += 1;
    totals.set(k, entry);
  }
  return months.map((m) => {
    const entry = totals.get(m.key);
    const pct = entry && entry.total > 0 ? Math.round((entry.completed / entry.total) * 100) : 0;
    return { label: m.label, value: pct };
  });
}

export async function getSchoolAdminAnalyticsExtras(schoolId: string) {
  const months6 = lastNMonths(6);
  const sixMonthsAgo = months6[0].start;
  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    feesCollectedThisMonth,
    feesPendingAgg,
    homeworkAssigned,
    homeworkPending,
    reportCardsPublished,
    admissionDates,
    feePaymentRows,
    homeworkStatusRows,
    classDistributionRows,
    recentAnnouncements,
    feeStructuresWithPending,
    pendingHomeworkReviews,
    recentReportCards,
  ] = await Promise.all([
    prisma.feePayment.aggregate({
      where: { schoolId, status: "PAID", paidAt: { gte: startOfThisMonth } },
      _sum: { amount: true },
    }),
    prisma.feePayment.aggregate({ where: { schoolId, status: "PENDING" }, _sum: { amount: true } }),
    prisma.homework.count({ where: { schoolId } }),
    prisma.homeworkStudentStatus.count({ where: { status: "PENDING", homework: { schoolId } } }),
    prisma.reportCard.count({ where: { schoolId, status: "PUBLISHED" } }),
    prisma.student.findMany({ where: { schoolId, createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true } }),
    prisma.feePayment.findMany({
      where: { schoolId, status: "PAID", paidAt: { gte: sixMonthsAgo } },
      select: { amount: true, paidAt: true },
    }),
    prisma.homeworkStudentStatus.findMany({
      where: { homework: { schoolId, dueDate: { gte: sixMonthsAgo } } },
      select: { status: true, homework: { select: { dueDate: true } } },
    }),
    prisma.student.findMany({ where: { schoolId }, select: { section: { select: { class: { select: { name: true } } } } } }),
    prisma.announcement.findMany({
      where: { schoolId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: { id: true, title: true, publishedAt: true },
    }),
    prisma.feeStructure.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
        frequency: true,
        payments: { where: { status: "PENDING" }, select: { amount: true } },
      },
    }),
    prisma.homeworkSubmission.findMany({
      where: { schoolId, checkedAt: null, submissionStatus: { in: ["SUBMITTED", "LATE_SUBMITTED"] } },
      orderBy: { submittedAt: "desc" },
      take: 5,
      select: {
        id: true,
        submittedAt: true,
        homework: { select: { title: true, subject: true } },
        student: { select: { name: true } },
      },
    }),
    prisma.reportCard.findMany({
      where: { schoolId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: {
        id: true,
        publishedAt: true,
        student: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } } } },
      },
    }),
  ]);

  const charts = {
    monthlyAdmissions: bucketCounts(admissionDates.map((s) => s.createdAt), months6),
    feeCollectionTrend: bucketSums(
      feePaymentRows.filter((r) => r.paidAt).map((r) => ({ date: r.paidAt as Date, amount: Number(r.amount) })),
      months6
    ),
    homeworkCompletionTrend: bucketHomeworkCompletion(
      homeworkStatusRows.map((r) => ({ status: r.status, dueDate: r.homework.dueDate })),
      months6
    ),
    classDistribution: (() => {
      const counts = new Map<string, number>();
      for (const row of classDistributionRows) {
        const name = row.section?.class.name ?? "Unassigned";
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => a.label.localeCompare(b.label));
    })(),
  };

  const feeStructuresAwaitingPayment = feeStructuresWithPending
    .map((fs) => ({
      id: fs.id,
      name: fs.name,
      frequency: fs.frequency,
      pendingCount: fs.payments.length,
      pendingAmount: fs.payments.reduce((sum, p) => sum + Number(p.amount), 0),
    }))
    .filter((fs) => fs.pendingCount > 0)
    .sort((a, b) => b.pendingAmount - a.pendingAmount)
    .slice(0, 5);

  return {
    kpis: {
      feesCollected: Number(feesCollectedThisMonth._sum.amount ?? 0),
      feesPending: Number(feesPendingAgg._sum.amount ?? 0),
      homeworkAssigned,
      homeworkPending,
      reportCardsPublished,
    },
    charts,
    operational: {
      recentAnnouncements,
      feeStructuresAwaitingPayment,
      pendingHomeworkReviews: pendingHomeworkReviews.map((s) => ({
        id: s.id,
        title: s.homework.title,
        subject: s.homework.subject,
        studentName: s.student.name,
        submittedAt: s.submittedAt,
      })),
      recentReportCards: recentReportCards.map((rc) => ({
        id: rc.id,
        studentName: rc.student.name,
        sectionLabel: `${rc.section.class.name}-${rc.section.name}`,
        publishedAt: rc.publishedAt,
      })),
    },
  };
}
