/**
 * School Operations Command Center — fee today insights (PART 18).
 * Manual ledger only (no online payment gateway reintroduced). All amounts
 * flow through `moneyToNumber` (money.ts) for Decimal-safety.
 *
 * `totalExpectedAmount` reuses the SAME per-student-fee-account convention as
 * student-fee-ledger.ts (a FeeStructure's `amount` is that structure's total
 * due per applicable student, not a frequency-multiplied recurring charge —
 * matching the existing ledger builder exactly) but computed via
 * FeeStructure x student-count aggregates (groupBy), never a per-student JS
 * loop over the whole roster.
 */

import { prisma } from "@/lib/prisma";
import { moneyToNumber } from "@/lib/money";

export interface FeeTodaySummary {
  paymentsRecordedToday: number;
  amountRecordedToday: number;
  monthToDateAmount: number;
  totalExpectedAmount: number;
  totalPaidAllTime: number;
  outstandingAmount: number;
}

export interface RecentFeePayment {
  id: string;
  studentId: string;
  studentName: string;
  amount: number;
  method: string | null;
  createdAt: Date;
}

const RECENT_PAYMENTS_LIMIT = 10;

function nextDay(d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n;
}

function startOfMonth(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), 1);
  s.setHours(0, 0, 0, 0);
  return s;
}

export async function computeFeeTodaySummary(schoolId: string, dateOnly: Date): Promise<FeeTodaySummary> {
  const tomorrow = nextDay(dateOnly);
  const monthStart = startOfMonth(dateOnly);

  const [todayAgg, monthAgg, allTimePaidAgg, feeStructures, sections, studentCountsBySection] = await Promise.all([
    prisma.feePayment.aggregate({ where: { schoolId, status: "PAID", createdAt: { gte: dateOnly, lt: tomorrow } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.feePayment.aggregate({ where: { schoolId, status: "PAID", createdAt: { gte: monthStart, lt: tomorrow } }, _sum: { amount: true } }),
    prisma.feePayment.aggregate({ where: { schoolId, status: "PAID" }, _sum: { amount: true } }),
    prisma.feeStructure.findMany({ where: { schoolId }, select: { amount: true, classId: true } }),
    prisma.section.findMany({ where: { class: { schoolId } }, select: { id: true, classId: true } }),
    prisma.student.groupBy({ by: ["sectionId"], where: { schoolId }, _count: { _all: true } }),
  ]);

  const sectionToClass = new Map(sections.map((s) => [s.id, s.classId]));
  const studentCountByClass = new Map<string, number>();
  let totalStudents = 0;
  for (const row of studentCountsBySection) {
    totalStudents += row._count._all;
    const classId = sectionToClass.get(row.sectionId);
    if (classId) studentCountByClass.set(classId, (studentCountByClass.get(classId) ?? 0) + row._count._all);
  }

  const totalExpectedAmount = feeStructures.reduce((sum, fs) => {
    const applicableCount = fs.classId ? (studentCountByClass.get(fs.classId) ?? 0) : totalStudents;
    return sum + moneyToNumber(fs.amount) * applicableCount;
  }, 0);

  const totalPaidAllTime = moneyToNumber(allTimePaidAgg._sum.amount ?? 0);

  return {
    paymentsRecordedToday: todayAgg._count._all,
    amountRecordedToday: moneyToNumber(todayAgg._sum.amount ?? 0),
    monthToDateAmount: moneyToNumber(monthAgg._sum.amount ?? 0),
    totalExpectedAmount,
    totalPaidAllTime,
    outstandingAmount: Math.max(0, totalExpectedAmount - totalPaidAllTime),
  };
}

export async function recentFeePayments(schoolId: string, limit = RECENT_PAYMENTS_LIMIT): Promise<RecentFeePayment[]> {
  const rows = await prisma.feePayment.findMany({
    where: { schoolId, status: "PAID" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, studentId: true, amount: true, method: true, createdAt: true, student: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: r.student.name,
    amount: moneyToNumber(r.amount),
    method: r.method,
    createdAt: r.createdAt,
  }));
}
