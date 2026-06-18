import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import { getRevenueSummary } from "@/lib/revenue";
import { formatCurrency } from "@/lib/utils";
import { IndianRupee, Wallet, Building2, Hourglass, XCircle, Ban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_COLORS = {
  ACTIVE: "bg-green-500",
  TRIAL: "bg-yellow-500",
  EXPIRED: "bg-zinc-400",
  SUSPENDED: "bg-red-500",
} as const;

const PLAN_BAR_COLORS = ["bg-indigo-600", "bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500"];

export default async function FounderRevenuePage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  const revenue = await getRevenueSummary();

  const statCards = [
    { title: "Monthly Revenue", value: formatCurrency(revenue.monthlyRevenue), icon: IndianRupee },
    { title: "Annual Revenue", value: formatCurrency(revenue.annualRevenue), icon: Wallet },
    { title: "Active Subscriptions", value: revenue.activeSubscriptions, icon: Building2 },
    { title: "Trial Schools", value: revenue.trialSchools, icon: Hourglass },
    { title: "Expired Schools", value: revenue.expiredSchools, icon: XCircle },
    { title: "Suspended Schools", value: revenue.suspendedSchools, icon: Ban },
  ];

  const statusBreakdown = [
    { label: "Active", value: revenue.activeSubscriptions, color: STATUS_COLORS.ACTIVE },
    { label: "Trial", value: revenue.trialSchools, color: STATUS_COLORS.TRIAL },
    { label: "Expired", value: revenue.expiredSchools, color: STATUS_COLORS.EXPIRED },
    { label: "Suspended", value: revenue.suspendedSchools, color: STATUS_COLORS.SUSPENDED },
  ];
  const totalSchools = statusBreakdown.reduce((sum, s) => sum + s.value, 0);

  const maxPlanRevenue = Math.max(1, ...revenue.revenueByPlan.map((p) => p.monthlyRevenue));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-6 md:p-7"
        style={{ background: "linear-gradient(120deg, rgba(99,102,241,0.14), rgba(99,102,241,0.03) 60%, transparent)" }}
      >
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Revenue</p>
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground md:text-3xl">Platform Revenue Dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">Recurring revenue and subscription health across every school.</p>
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-indigo-500/10 blur-2xl" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.title} className="border-border transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{stat.value}</p>
                </div>
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Revenue by plan */}
        <Card className="border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Revenue by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue.revenueByPlan.length === 0 ? (
              <EmptyState message="No active subscriptions yet." />
            ) : (
              <div className="space-y-5">
                {revenue.revenueByPlan.map((plan, i) => (
                  <div key={plan.planId}>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-sm font-medium text-foreground">{plan.planName}</span>
                      <span className="text-sm text-muted-foreground">
                        {formatCurrency(plan.monthlyRevenue)}/mo &middot; {plan.schoolCount} school{plan.schoolCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${PLAN_BAR_COLORS[i % PLAN_BAR_COLORS.length]} transition-all`}
                        style={{ width: `${Math.max(4, (plan.monthlyRevenue / maxPlanRevenue) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscription status breakdown */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">School Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {totalSchools === 0 ? (
              <EmptyState message="No schools yet." />
            ) : (
              <div className="space-y-4">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                  {statusBreakdown.map((s) =>
                    s.value > 0 ? (
                      <div
                        key={s.label}
                        className={s.color}
                        style={{ width: `${(s.value / totalSchools) * 100}%` }}
                      />
                    ) : null
                  )}
                </div>
                <ul className="space-y-2.5">
                  {statusBreakdown.map((s) => (
                    <li key={s.label} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span className={`h-2 w-2 rounded-full ${s.color}`} />
                        {s.label}
                      </span>
                      <span className="font-semibold text-foreground">{s.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
