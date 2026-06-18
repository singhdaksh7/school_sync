import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { isSchoolPaymentOverdue } from "@/lib/payment-overdue";

const PAGE_SIZE = 10;
const VALID_STATUSES = ["ACTIVE", "TRIAL", "EXPIRED", "SUSPENDED"] as const;

export async function GET(req: Request) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  const status = searchParams.get("status")?.trim().toUpperCase() || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const where: Prisma.SchoolWhereInput = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
    ];
  }
  if (VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    where.status = status as (typeof VALID_STATUSES)[number];
  }

  const [schools, total] = await Promise.all([
    prisma.school.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        _count: { select: { students: true, teachers: true, guardians: true, admins: true } },
        subscription: {
          select: {
            billingCycle: true,
            amount: true,
            currentPeriodEnd: true,
            plan: { select: { name: true } },
          },
        },
      },
    }),
    prisma.school.count({ where }),
  ]);

  const schoolIds = schools.map((s) => s.id);
  const submissions = schoolIds.length
    ? await prisma.paymentProofSubmission.findMany({
        where: { schoolId: { in: schoolIds } },
        select: { schoolId: true, status: true, billingMonth: true },
      })
    : [];
  const submissionsBySchool = new Map<string, typeof submissions>();
  for (const s of submissions) {
    submissionsBySchool.set(s.schoolId, [...(submissionsBySchool.get(s.schoolId) ?? []), s]);
  }

  const schoolsWithOverdue = schools.map((school) => ({
    ...school,
    isOverdue: isSchoolPaymentOverdue(school.subscription, submissionsBySchool.get(school.id) ?? []),
  }));

  return NextResponse.json({
    schools: schoolsWithOverdue,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
