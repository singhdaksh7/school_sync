import { prisma } from "@/lib/prisma";
import { getRevenueSummary } from "@/lib/revenue";
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
  for (const d of dates) {
    const k = monthKey(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return months.map((m) => ({ label: m.label, value: counts.get(m.key) ?? 0 }));
}

function cumulativeCounts(sortedDates: Date[], months: ReturnType<typeof lastNMonths>): TrendPoint[] {
  let idx = 0;
  const points: TrendPoint[] = [];
  for (const m of months) {
    while (idx < sortedDates.length && sortedDates[idx].getTime() <= m.end.getTime()) idx++;
    points.push({ label: m.label, value: idx });
  }
  return points;
}

function bucketSums(rows: { date: Date; amount: number }[], months: ReturnType<typeof lastNMonths>): TrendPoint[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const k = monthKey(r.date);
    sums.set(k, (sums.get(k) ?? 0) + r.amount);
  }
  return months.map((m) => ({ label: m.label, value: Math.round(sums.get(m.key) ?? 0) }));
}

export async function getFounderAnalyticsOverview() {
  const months12 = lastNMonths(12);
  const months6 = lastNMonths(6);
  const sixMonthsAgo = months6[0].start;
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalSchools,
    activeSchools,
    trialSchools,
    expiredSchools,
    suspendedSchools,
    totalStudents,
    totalTeachers,
    totalParents,
    totalSchoolAdmins,
    pendingPaymentVerifications,
    revenue,
    schoolDates,
    studentDates,
    invoiceStatusSums,
    paidInvoices,
    renewalRemindersCount,
    onboardedSchools,
    approvedPayments,
    recentlyExpiredSchools,
    awaitingVerification,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.school.count({ where: { status: "ACTIVE" } }),
    prisma.school.count({ where: { status: "TRIAL" } }),
    prisma.school.count({ where: { status: "EXPIRED" } }),
    prisma.school.count({ where: { status: "SUSPENDED" } }),
    prisma.student.count(),
    prisma.teacher.count(),
    prisma.guardian.count(),
    prisma.user.count({ where: { role: "SCHOOL_ADMIN" } }),
    prisma.paymentProofSubmission.count({ where: { status: "PENDING" } }),
    getRevenueSummary(),
    prisma.school.findMany({ select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.student.findMany({ select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.invoice.groupBy({ by: ["status"], _sum: { amount: true } }),
    prisma.invoice.findMany({
      where: { status: "PAID", billingPeriodStart: { gte: sixMonthsAgo } },
      select: { amount: true, billingPeriodStart: true },
    }),
    prisma.schoolSubscription.count({ where: { currentPeriodEnd: { gte: now, lte: in30Days } } }),
    prisma.school.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
    }),
    prisma.paymentProofSubmission.findMany({
      where: { status: "APPROVED" },
      orderBy: { reviewedAt: "desc" },
      take: 5,
      select: { id: true, amount: true, reviewedAt: true, school: { select: { name: true, slug: true } } },
    }),
    prisma.school.findMany({
      where: { status: "EXPIRED" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, name: true, slug: true, updatedAt: true },
    }),
    prisma.paymentProofSubmission.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true, amount: true, billingMonth: true, createdAt: true, school: { select: { name: true, slug: true } } },
    }),
  ]);

  const schoolCreatedDates = schoolDates.map((s) => s.createdAt);
  const studentCreatedDates = studentDates.map((s) => s.createdAt);

  const invoiceSumByStatus = new Map<string, number>();
  for (const row of invoiceStatusSums) {
    invoiceSumByStatus.set(row.status, Number(row._sum.amount ?? 0));
  }

  const charts = {
    newRegistrations: bucketCounts(
      schoolCreatedDates.filter((d) => d >= sixMonthsAgo),
      months6
    ),
    schoolGrowth: cumulativeCounts(schoolCreatedDates, months12),
    studentGrowth: cumulativeCounts(studentCreatedDates, months12),
    revenueTrend: bucketSums(
      paidInvoices.map((inv) => ({ date: inv.billingPeriodStart, amount: Number(inv.amount) })),
      months6
    ),
  };

  const statusBreakdown = [
    { label: "Active", value: activeSchools, color: "bg-green-500" },
    { label: "Trial", value: trialSchools, color: "bg-yellow-500" },
    { label: "Expired", value: expiredSchools, color: "bg-zinc-400" },
    { label: "Suspended", value: suspendedSchools, color: "bg-red-500" },
  ];

  return {
    kpis: {
      totalSchools,
      activeSchools,
      trialSchools,
      expiredSchools,
      suspendedSchools,
      totalStudents,
      totalTeachers,
      totalParents,
      totalSchoolAdmins,
      monthlyRevenue: revenue.monthlyRevenue,
      annualRevenue: revenue.annualRevenue,
      activeSubscriptions: revenue.activeSubscriptions,
      pendingPaymentVerifications,
    },
    charts,
    statusBreakdown,
    revenueByPlan: revenue.revenueByPlan,
    revenueSummary: {
      monthlyRevenue: revenue.monthlyRevenue,
      annualRevenue: revenue.annualRevenue,
      totalCollected: invoiceSumByStatus.get("PAID") ?? 0,
      pendingRevenue: invoiceSumByStatus.get("ISSUED") ?? 0,
      overdueAmount: invoiceSumByStatus.get("OVERDUE") ?? 0,
      renewalRemindersCount,
    },
    recentActivity: {
      onboardedSchools,
      approvedPayments: approvedPayments.map((p) => ({
        id: p.id,
        schoolName: p.school.name,
        schoolSlug: p.school.slug,
        amount: Number(p.amount),
        reviewedAt: p.reviewedAt,
      })),
      expiredSubscriptions: recentlyExpiredSchools,
      awaitingVerification: awaitingVerification.map((p) => ({
        id: p.id,
        schoolName: p.school.name,
        schoolSlug: p.school.slug,
        amount: Number(p.amount),
        billingMonth: p.billingMonth,
        createdAt: p.createdAt,
      })),
    },
  };
}

export type FounderAnalyticsOverview = ReturnType<typeof getFounderAnalyticsOverview> extends Promise<infer T> ? T : never;
