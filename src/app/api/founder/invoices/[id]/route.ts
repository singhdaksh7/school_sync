import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { INVOICE_STATUSES, type InvoiceStatusValue } from "@/lib/billing-status";
import { createNotification } from "@/lib/founder-notifications";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { school: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } } },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ invoice });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, status: true, invoiceNumber: true, schoolId: true, school: { select: { name: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const data: { status?: InvoiceStatusValue; notes?: string | null; amount?: number; dueDate?: Date } = {};

  if (body?.status !== undefined) {
    if (!INVOICE_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = body.status;
  }
  if (body?.notes !== undefined) {
    data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  }
  if (body?.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
    }
    data.amount = amount;
  }
  if (body?.dueDate !== undefined) {
    const dueDate = new Date(body.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
    }
    data.dueDate = dueDate;
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data,
    include: { school: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } } },
  });

  if (data.status === "OVERDUE" && existing.status !== "OVERDUE") {
    await createNotification({
      type: "INVOICE_OVERDUE",
      title: "Invoice marked overdue",
      message: `Invoice ${existing.invoiceNumber} for ${existing.school.name} is now overdue.`,
      schoolId: existing.schoolId,
    });
  }

  return NextResponse.json({ invoice });
}
