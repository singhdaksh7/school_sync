import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";
import { slugify } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { createPlanSchema, listActivePlans, toMinorUnits, SELECTABLE_PLAN_ORDER } from "@/lib/plan-catalogue";

export async function GET(req: Request) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  // Consumed by every "pick a plan" UI (Add School, admin invite) so an
  // inactive plan can never be silently offered again once deactivated.
  const activeOnly = searchParams.get("activeOnly") === "true";

  const plans = activeOnly
    ? await listActivePlans()
    : await prisma.subscriptionPlan.findMany({
        orderBy: SELECTABLE_PLAN_ORDER,
        include: { _count: { select: { subscriptions: true } } },
      });

  return NextResponse.json({ plans });
}

export async function POST(req: Request) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid plan payload" }, { status: 400 });
  }
  const input = parsed.data;

  let priceMonthlyMinor: number;
  let priceAnnualMinor: number;
  try {
    priceMonthlyMinor = toMinorUnits(input.priceMonthly);
    priceAnnualMinor = toMinorUnits(input.priceAnnual);
  } catch {
    return NextResponse.json({ error: "Prices must be non-negative numbers" }, { status: 400 });
  }

  try {
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: input.name,
        slug: slugify(input.name),
        description: input.description ?? null,
        currency: input.currency,
        priceMonthly: input.priceMonthly,
        priceAnnual: input.priceAnnual,
        priceMonthlyMinor,
        priceAnnualMinor,
        maxStudents: input.maxStudents ?? null,
        staffLimit: input.staffLimit ?? null,
        enabledFeatures: input.enabledFeatures ?? [],
      },
    });

    await logAudit({
      action: "PLAN_CREATED",
      entityType: "SubscriptionPlan",
      entityId: plan.id,
      metadata: { name: plan.name, slug: plan.slug },
      userId: session.user.id,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ error: "A plan with this name already exists" }, { status: 409 });
    }
    throw error;
  }
}
