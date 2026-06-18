import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { normalizeToMonthStart } from "@/lib/payment-overdue";

const BILLING_CYCLES = ["MONTHLY", "ANNUAL"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { schoolId } = await params;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const planId = typeof body?.planId === "string" ? body.planId : "";
  const billingCycle = body?.billingCycle;
  const amount = Number(body?.amount);
  const currentPeriodEndInput = body?.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null;

  if (!planId) return NextResponse.json({ error: "Plan is required" }, { status: 400 });
  if (!BILLING_CYCLES.includes(billingCycle)) {
    return NextResponse.json({ error: "Invalid billing cycle" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
  }
  if (currentPeriodEndInput && Number.isNaN(currentPeriodEndInput.getTime())) {
    return NextResponse.json({ error: "Invalid renewal date" }, { status: 400 });
  }

  // Renewal dates are always the 1st of a month, whether set automatically
  // (on payment approval) or manually here.
  const currentPeriodEnd = currentPeriodEndInput ? normalizeToMonthStart(currentPeriodEndInput) : null;

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const subscription = await prisma.schoolSubscription.upsert({
    where: { schoolId },
    create: { schoolId, planId, billingCycle, amount, currentPeriodEnd },
    update: { planId, billingCycle, amount, currentPeriodEnd },
    include: { plan: true },
  });

  return NextResponse.json({ subscription });
}
