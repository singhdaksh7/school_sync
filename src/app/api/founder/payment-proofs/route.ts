import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { PAYMENT_PROOF_STATUSES, type PaymentProofStatusValue } from "@/lib/billing-status";

const PAGE_SIZE = 10;

export async function GET(req: Request) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim().toUpperCase() || "";
  const schoolId = searchParams.get("schoolId")?.trim() || "";
  const school = searchParams.get("school")?.trim() || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const where: Prisma.PaymentProofSubmissionWhereInput = {};
  if (PAYMENT_PROOF_STATUSES.includes(status as PaymentProofStatusValue)) {
    where.status = status as PaymentProofStatusValue;
  }
  if (schoolId) where.schoolId = schoolId;
  if (school) where.school = { name: { contains: school, mode: "insensitive" } };

  const [submissions, total] = await Promise.all([
    prisma.paymentProofSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        billingMonth: true,
        paymentDate: true,
        amount: true,
        transactionRef: true,
        status: true,
        createdAt: true,
        school: { select: { id: true, name: true } },
        submittedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.paymentProofSubmission.count({ where }),
  ]);

  return NextResponse.json({
    submissions,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
