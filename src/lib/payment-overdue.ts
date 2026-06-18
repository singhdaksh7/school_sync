type SubscriptionLike = { currentPeriodEnd: Date | string | null } | null | undefined;
type SubmissionLike = { status: string; billingMonth: Date | string };

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Renewal dates are always normalized to the 1st of a month — whether set
// automatically (on approval) or manually (Founder edits the subscription).
export function normalizeToMonthStart(date: Date) {
  return startOfMonth(date);
}

// The next renewal date after a billing month has been paid for: the 1st of
// the month after the cycle just covered (1 month for MONTHLY, 12 for ANNUAL).
export function getNextRenewalDate(billingMonth: Date, billingCycle: "MONTHLY" | "ANNUAL") {
  const monthsToAdd = billingCycle === "ANNUAL" ? 12 : 1;
  const cycleStart = startOfMonth(billingMonth);
  return new Date(cycleStart.getFullYear(), cycleStart.getMonth() + monthsToAdd, 1);
}

// A school is overdue when its renewal date has passed and no APPROVED
// payment proof exists for that billing cycle (or later). Purely a read-time
// computation — no schema column, no automatic status mutation.
export function isSchoolPaymentOverdue(subscription: SubscriptionLike, submissions: SubmissionLike[]): boolean {
  if (!subscription?.currentPeriodEnd) return false;

  const renewalDate = new Date(subscription.currentPeriodEnd);
  const now = new Date();
  if (renewalDate >= now) return false;

  const cycleStart = startOfMonth(renewalDate);
  return !submissions.some((s) => s.status === "APPROVED" && startOfMonth(new Date(s.billingMonth)) >= cycleStart);
}
