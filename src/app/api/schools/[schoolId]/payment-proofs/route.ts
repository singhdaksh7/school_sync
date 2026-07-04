import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchoolForBilling, sessionRole } from "@/lib/tenant";
import { createNotification } from "@/lib/founder-notifications";

// ~2MB of original file data, base64-encoded (base64 inflates size by ~4/3).
const MAX_RECEIPT_DATA_LENGTH = 2_900_000;

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Billing recovery path: intentionally status-EXEMPT so a suspended/expired
  // school can still submit the payment proof that gets it reinstated.
  if (!(await canAccessSchoolForBilling(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const submissions = await prisma.paymentProofSubmission.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      billingMonth: true,
      paymentDate: true,
      amount: true,
      transactionRef: true,
      notes: true,
      status: true,
      reviewNotes: true,
      reviewedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ submissions });
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Billing recovery path: intentionally status-EXEMPT so a suspended/expired
  // school can still submit the payment proof that gets it reinstated.
  if (!(await canAccessSchoolForBilling(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const billingMonthInput = body?.billingMonth ? new Date(body.billingMonth) : null;
  const billingMonth = billingMonthInput && !Number.isNaN(billingMonthInput.getTime())
    ? new Date(billingMonthInput.getFullYear(), billingMonthInput.getMonth(), 1)
    : null;
  const paymentDate = body?.paymentDate ? new Date(body.paymentDate) : null;
  const amount = Number(body?.amount);
  const transactionRef = typeof body?.transactionRef === "string" && body.transactionRef.trim() ? body.transactionRef.trim() : null;
  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const receiptData = typeof body?.receiptData === "string" ? body.receiptData : "";
  const receiptFileName = typeof body?.receiptFileName === "string" ? body.receiptFileName : null;
  const receiptMimeType = typeof body?.receiptMimeType === "string" ? body.receiptMimeType : null;

  if (!billingMonth || Number.isNaN(billingMonth.getTime())) {
    return NextResponse.json({ error: "Billing month is required" }, { status: 400 });
  }
  if (!paymentDate || Number.isNaN(paymentDate.getTime())) {
    return NextResponse.json({ error: "Payment date is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  if (!receiptData) {
    return NextResponse.json({ error: "Receipt screenshot or PDF is required" }, { status: 400 });
  }
  if (receiptData.length > MAX_RECEIPT_DATA_LENGTH) {
    return NextResponse.json({ error: "Receipt file is too large (max ~2MB)" }, { status: 400 });
  }

  const duplicate = await prisma.paymentProofSubmission.findFirst({
    where: { schoolId, billingMonth, status: { in: ["PENDING", "APPROVED"] } },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "A submission for this billing month already exists and is pending or approved." },
      { status: 409 }
    );
  }

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } });

  const submission = await prisma.paymentProofSubmission.create({
    data: {
      schoolId,
      billingMonth,
      paymentDate,
      amount,
      transactionRef,
      notes,
      receiptData,
      receiptFileName,
      receiptMimeType,
      submittedById: session.user.id,
    },
  });

  await createNotification({
    type: "PAYMENT_PROOF_SUBMITTED",
    title: "Payment proof submitted",
    message: `${school?.name ?? "A school"} submitted a payment proof for review.`,
    schoolId,
  });

  return NextResponse.json({ submission }, { status: 201 });
}
