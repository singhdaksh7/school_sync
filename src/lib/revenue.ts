import { prisma } from "@/lib/prisma";
import { paiseFromRupees } from "@/lib/money";

/** Decimal-safe monthly-equivalent, in integer paise (never float rupees). */
export function monthlyEquivalentPaise(amountPaise: number, billingCycle: "MONTHLY" | "ANNUAL") {
  return billingCycle === "ANNUAL" ? Math.round(amountPaise / 12) : amountPaise;
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

/**
 * Aggregates SaaS subscription revenue via DB-side groupBy — one row per
 * (plan, billingCycle) combination, never one row per school/subscription.
 * All money math happens in integer paise (never float rupees) until the
 * final response, so summing many Decimal amounts never drifts.
 */
export async function getRevenueSummary(): Promise<RevenueSummary> {
  const [statusCounts, activeByPlanCycle, plans] = await Promise.all([
    prisma.school.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.schoolSubscription.groupBy({
      by: ["planId", "billingCycle"],
      where: { school: { status: "ACTIVE" } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.subscriptionPlan.findMany({ select: { id: true, name: true } }),
  ]);

  const statusMap: Record<string, number> = { ACTIVE: 0, TRIAL: 0, EXPIRED: 0, SUSPENDED: 0 };
  for (const row of statusCounts) statusMap[row.status] = row._count._all;
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));

  let totalMonthlyPaise = 0;
  let activeSubscriptions = 0;
  const byPlan = new Map<string, { planId: string; planName: string; schoolCount: number; monthlyPaise: number }>();

  for (const row of activeByPlanCycle) {
    const amountPaise = paiseFromRupees(row._sum.amount ?? 0);
    const monthlyPaise = monthlyEquivalentPaise(amountPaise, row.billingCycle);
    totalMonthlyPaise += monthlyPaise;
    activeSubscriptions += row._count._all;

    const entry = byPlan.get(row.planId) ?? {
      planId: row.planId,
      planName: planNameById.get(row.planId) ?? "Unknown plan",
      schoolCount: 0,
      monthlyPaise: 0,
    };
    entry.schoolCount += row._count._all;
    entry.monthlyPaise += monthlyPaise;
    byPlan.set(row.planId, entry);
  }

  const monthlyRevenue = totalMonthlyPaise / 100;

  return {
    monthlyRevenue,
    annualRevenue: monthlyRevenue * 12,
    activeSubscriptions,
    trialSchools: statusMap.TRIAL,
    expiredSchools: statusMap.EXPIRED,
    suspendedSchools: statusMap.SUSPENDED,
    revenueByPlan: Array.from(byPlan.values())
      .map((e) => ({ planId: e.planId, planName: e.planName, schoolCount: e.schoolCount, monthlyRevenue: e.monthlyPaise / 100 }))
      .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue),
  };
}
