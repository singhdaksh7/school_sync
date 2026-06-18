import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";

export async function PATCH(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { planId } = await params;
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const data: { name?: string; priceMonthly?: number; priceAnnual?: number; maxStudents?: number | null; isActive?: boolean } = {};

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    data.name = name;
  }
  if (body?.priceMonthly !== undefined) {
    const priceMonthly = Number(body.priceMonthly);
    if (!Number.isFinite(priceMonthly) || priceMonthly < 0) {
      return NextResponse.json({ error: "Monthly price must be a non-negative number" }, { status: 400 });
    }
    data.priceMonthly = priceMonthly;
  }
  if (body?.priceAnnual !== undefined) {
    const priceAnnual = Number(body.priceAnnual);
    if (!Number.isFinite(priceAnnual) || priceAnnual < 0) {
      return NextResponse.json({ error: "Annual price must be a non-negative number" }, { status: 400 });
    }
    data.priceAnnual = priceAnnual;
  }
  if (body?.maxStudents !== undefined) {
    data.maxStudents = body.maxStudents === null || body.maxStudents === "" ? null : Number(body.maxStudents);
    if (data.maxStudents !== null && (!Number.isFinite(data.maxStudents) || data.maxStudents < 0)) {
      return NextResponse.json({ error: "Max students must be a non-negative number" }, { status: 400 });
    }
  }
  if (body?.isActive !== undefined) {
    data.isActive = Boolean(body.isActive);
  }

  try {
    const updated = await prisma.subscriptionPlan.update({ where: { id: planId }, data });
    return NextResponse.json({ plan: updated });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ error: "A plan with this name already exists" }, { status: 409 });
    }
    throw error;
  }
}
