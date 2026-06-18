import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";
import type { Prisma } from "@/generated/prisma/client";
import { INVOICE_STATUSES, type InvoiceStatusValue } from "@/lib/billing-status";

const PAGE_SIZE = 10;

export async function GET(req: Request) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim().toUpperCase() || "";
  const schoolId = searchParams.get("schoolId")?.trim() || "";
  const school = searchParams.get("school")?.trim() || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const where: Prisma.InvoiceWhereInput = {};
  if (INVOICE_STATUSES.includes(status as InvoiceStatusValue)) where.status = status as InvoiceStatusValue;
  if (schoolId) where.schoolId = schoolId;
  if (school) where.school = { name: { contains: school, mode: "insensitive" } };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        school: { select: { id: true, name: true } },
        plan: { select: { id: true, name: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return NextResponse.json({
    invoices,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

export async function POST(req: Request) {
  const session = await requireFounderSession();
  const userId = session?.user?.id;
  if (!session || !userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const invoiceNumber = typeof body?.invoiceNumber === "string" ? body.invoiceNumber.trim() : "";
  const schoolId = typeof body?.schoolId === "string" ? body.schoolId : "";
  const planId = typeof body?.planId === "string" && body.planId ? body.planId : null;
  const amount = Number(body?.amount);
  const billingPeriodStart = body?.billingPeriodStart ? new Date(body.billingPeriodStart) : null;
  const billingPeriodEnd = body?.billingPeriodEnd ? new Date(body.billingPeriodEnd) : null;
  const dueDate = body?.dueDate ? new Date(body.dueDate) : null;
  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (!invoiceNumber) return NextResponse.json({ error: "Invoice number is required" }, { status: 400 });
  if (!schoolId) return NextResponse.json({ error: "School is required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
  }
  if (!billingPeriodStart || Number.isNaN(billingPeriodStart.getTime())) {
    return NextResponse.json({ error: "Billing period start is required" }, { status: 400 });
  }
  if (!billingPeriodEnd || Number.isNaN(billingPeriodEnd.getTime())) {
    return NextResponse.json({ error: "Billing period end is required" }, { status: 400 });
  }
  if (!dueDate || Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: "Due date is required" }, { status: 400 });
  }

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  try {
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        schoolId,
        planId,
        amount,
        billingPeriodStart,
        billingPeriodEnd,
        dueDate,
        notes,
        createdById: userId,
      },
      include: { school: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      return NextResponse.json({ error: "An invoice with this number already exists" }, { status: 409 });
    }
    throw error;
  }
}
