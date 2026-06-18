import { prisma } from "@/lib/prisma";

function monthlyEquivalent(amount: unknown, billingCycle: "MONTHLY" | "ANNUAL") {
  const value = Number(amount);
  return billingCycle === "ANNUAL" ? value / 12 : value;
}

export type RevenueSummary = {
  monthlyRevenue: number;
  annualRevenue: number;
  activeSubscriptions: number;
  trialSchools: number;
  expiredSchools: number;
  suspendedSchools: number;
  revenueByPlan: { planId: string; planName: string; schoolCount: number; monthlyRevenue: number }[];
};

export async function getRevenueSummary(): Promise<RevenueSummary> {
  const [subscriptions, statusCounts] = await Promise.all([
    prisma.schoolSubscription.findMany({
      include: {
        plan: { select: { id: true, name: true } },
        school: { select: { status: true } },
      },
    }),
    prisma.school.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const statusMap: Record<string, number> = { ACTIVE: 0, TRIAL: 0, EXPIRED: 0, SUSPENDED: 0 };
  for (const row of statusCounts) statusMap[row.status] = row._count._all;

  const active = subscriptions.filter((s) => s.school.status === "ACTIVE");

  const monthlyRevenue = active.reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.billingCycle), 0);

  const byPlan = new Map<string, { planId: string; planName: string; schoolCount: number; monthlyRevenue: number }>();
  for (const s of active) {
    const entry = byPlan.get(s.plan.id) ?? { planId: s.plan.id, planName: s.plan.name, schoolCount: 0, monthlyRevenue: 0 };
    entry.schoolCount += 1;
    entry.monthlyRevenue += monthlyEquivalent(s.amount, s.billingCycle);
    byPlan.set(s.plan.id, entry);
  }

  return {
    monthlyRevenue,
    annualRevenue: monthlyRevenue * 12,
    activeSubscriptions: active.length,
    trialSchools: statusMap.TRIAL,
    expiredSchools: statusMap.EXPIRED,
    suspendedSchools: statusMap.SUSPENDED,
    revenueByPlan: Array.from(byPlan.values()).sort((a, b) => b.monthlyRevenue - a.monthlyRevenue),
  };
}
