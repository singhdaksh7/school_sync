import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { PAYMENT_PROOF_STATUSES, type PaymentProofStatusValue } from "@/lib/billing-status";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const submission = await prisma.paymentProofSubmission.findUnique({
    where: { id },
    include: {
      school: { select: { id: true, name: true } },
      submittedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
  });
  if (!submission) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ submission });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireFounderSession();
  const userId = session?.user?.id;
  if (!session || !userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.paymentProofSubmission.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : "";
  const reviewNotes = typeof body?.reviewNotes === "string" ? body.reviewNotes.trim() || null : undefined;

  if (status === "PENDING" || !PAYMENT_PROOF_STATUSES.includes(status as PaymentProofStatusValue)) {
    return NextResponse.json({ error: "Status must be APPROVED or REJECTED" }, { status: 400 });
  }

  const submission = await prisma.paymentProofSubmission.update({
    where: { id },
    data: {
      status: status as PaymentProofStatusValue,
      reviewNotes,
      reviewedById: userId,
      reviewedAt: new Date(),
    },
    include: { school: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ submission });
}
