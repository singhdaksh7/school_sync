import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";
import { slugify } from "@/lib/utils";

export async function GET() {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: { priceMonthly: "asc" },
    include: { _count: { select: { subscriptions: true } } },
  });
  return NextResponse.json({ plans });
}

export async function POST(req: Request) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const priceMonthly = Number(body?.priceMonthly);
  const priceAnnual = Number(body?.priceAnnual);
  const maxStudents = body?.maxStudents === null || body?.maxStudents === undefined || body?.maxStudents === ""
    ? null
    : Number(body.maxStudents);

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!Number.isFinite(priceMonthly) || priceMonthly < 0) {
    return NextResponse.json({ error: "Monthly price must be a non-negative number" }, { status: 400 });
  }
  if (!Number.isFinite(priceAnnual) || priceAnnual < 0) {
    return NextResponse.json({ error: "Annual price must be a non-negative number" }, { status: 400 });
  }
  if (maxStudents !== null && (!Number.isFinite(maxStudents) || maxStudents < 0)) {
    return NextResponse.json({ error: "Max students must be a non-negative number" }, { status: 400 });
  }

  try {
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name,
        slug: slugify(name),
        priceMonthly,
        priceAnnual,
        maxStudents,
      },
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ error: "A plan with this name already exists" }, { status: 409 });
    }
    throw error;
  }
}
