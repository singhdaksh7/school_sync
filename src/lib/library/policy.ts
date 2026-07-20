import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LIBRARY_POLICY } from "@/lib/library/constants";

export type EffectiveLibraryPolicy = {
  studentBorrowLimit: number;
  teacherBorrowLimit: number;
  studentLoanDurationDays: number;
  teacherLoanDurationDays: number;
  maxRenewals: number;
  graceDays: number;
  finePerOverdueDay: Prisma.Decimal;
  reservationsEnabled: boolean;
  reservationHoldDurationDays: number;
  blockBorrowingIfOverdue: boolean;
};

function defaults(): EffectiveLibraryPolicy {
  return {
    ...DEFAULT_LIBRARY_POLICY,
    finePerOverdueDay: new Prisma.Decimal(DEFAULT_LIBRARY_POLICY.finePerOverdueDay),
  };
}

/**
 * Returns the school's effective library policy: the persisted row when present,
 * else the product defaults. Never leaks internal audit fields (updatedById).
 */
export async function getEffectiveLibraryPolicy(
  schoolId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<EffectiveLibraryPolicy> {
  const row = await client.libraryPolicy.findUnique({ where: { schoolId } });
  if (!row) return defaults();
  return {
    studentBorrowLimit: row.studentBorrowLimit,
    teacherBorrowLimit: row.teacherBorrowLimit,
    studentLoanDurationDays: row.studentLoanDurationDays,
    teacherLoanDurationDays: row.teacherLoanDurationDays,
    maxRenewals: row.maxRenewals,
    graceDays: row.graceDays,
    finePerOverdueDay: row.finePerOverdueDay,
    reservationsEnabled: row.reservationsEnabled,
    reservationHoldDurationDays: row.reservationHoldDurationDays,
    blockBorrowingIfOverdue: row.blockBorrowingIfOverdue,
  };
}

export type BorrowerKind = "STUDENT" | "TEACHER";

export function borrowLimitFor(policy: EffectiveLibraryPolicy, kind: BorrowerKind): number {
  return kind === "STUDENT" ? policy.studentBorrowLimit : policy.teacherBorrowLimit;
}

export function loanDurationDaysFor(policy: EffectiveLibraryPolicy, kind: BorrowerKind): number {
  return kind === "STUDENT" ? policy.studentLoanDurationDays : policy.teacherLoanDurationDays;
}
