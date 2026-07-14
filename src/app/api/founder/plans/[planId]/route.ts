import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { updatePlanSchema, toMinorUnits } from "@/lib/plan-catalogue";
import type { Prisma } from "@/generated/prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { planId } = await params;
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid plan payload" }, { status: 400 });
  }
  const input = parsed.data;

  const data: Prisma.SubscriptionPlanUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.maxStudents !== undefined) data.maxStudents = input.maxStudents ?? null;
  if (input.staffLimit !== undefined) data.staffLimit = input.staffLimit ?? null;
  if (input.enabledFeatures !== undefined) data.enabledFeatures = input.enabledFeatures;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  try {
    if (input.priceMonthly !== undefined) {
      data.priceMonthly = input.priceMonthly;
      data.priceMonthlyMinor = toMinorUnits(input.priceMonthly);
    }
    if (input.priceAnnual !== undefined) {
      data.priceAnnual = input.priceAnnual;
      data.priceAnnualMinor = toMinorUnits(input.priceAnnual);
    }
  } catch {
    return NextResponse.json({ error: "Prices must be non-negative numbers" }, { status: 400 });
  }

  try {
    const updated = await prisma.subscriptionPlan.update({ where: { id: planId }, data });

    await logAudit({
      action: "PLAN_UPDATED",
      entityType: "SubscriptionPlan",
      entityId: updated.id,
      metadata: { changedFields: Object.keys(data) },
      userId: session.user.id,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ plan: updated });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ error: "A plan with this name already exists" }, { status: 409 });
    }
    throw error;
  }
}

/**
 * Hard delete is only permitted for a plan that has never been assigned to a
 * school (zero SchoolSubscription rows) — otherwise callers must deactivate
 * it instead (PATCH isActive:false). This is the ticket's "prevent
 * destructive deletion of any plan assigned to a school" guarantee, enforced
 * server-side rather than merely hidden in the UI.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { planId } = await params;
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    include: { _count: { select: { subscriptions: true } } },
  });
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (plan._count.subscriptions > 0) {
    return NextResponse.json(
      { error: `This plan is assigned to ${plan._count.subscriptions} school(s). Deactivate it instead of deleting.` },
      { status: 409 }
    );
  }

  try {
    await prisma.subscriptionPlan.delete({ where: { id: planId } });
  } catch (error) {
    // A concurrent assignment landed between our count check and the delete —
    // surface the same 409 rather than a raw FK-violation 500.
    if (hasPrismaErrorCode(error, "P2003")) {
      return NextResponse.json({ error: "This plan was just assigned to a school. Deactivate it instead of deleting." }, { status: 409 });
    }
    throw error;
  }

  await logAudit({
    action: "PLAN_UPDATED",
    entityType: "SubscriptionPlan",
    entityId: planId,
    metadata: { deleted: true, name: plan.name, slug: plan.slug },
    userId: session.user.id,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
}
