import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { libraryPolicy: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getEffectiveLibraryPolicy, borrowLimitFor, loanDurationDaysFor } from "@/lib/library/policy";

const p = prisma as unknown as { libraryPolicy: { findUnique: ReturnType<typeof vi.fn> } };

beforeEach(() => vi.clearAllMocks());

describe("getEffectiveLibraryPolicy", () => {
  it("returns product defaults when no row exists", async () => {
    p.libraryPolicy.findUnique.mockResolvedValue(null);
    const policy = await getEffectiveLibraryPolicy("s1");
    expect(policy.studentBorrowLimit).toBe(3);
    expect(policy.teacherBorrowLimit).toBe(5);
    expect(policy.studentLoanDurationDays).toBe(14);
    expect(policy.teacherLoanDurationDays).toBe(30);
    expect(policy.maxRenewals).toBe(2);
    expect(policy.graceDays).toBe(1);
    expect(policy.finePerOverdueDay.toFixed(2)).toBe("2.00");
    expect(policy.reservationsEnabled).toBe(true);
    expect(policy.blockBorrowingIfOverdue).toBe(true);
  });

  it("returns the persisted row when present", async () => {
    p.libraryPolicy.findUnique.mockResolvedValue({
      studentBorrowLimit: 7,
      teacherBorrowLimit: 9,
      studentLoanDurationDays: 21,
      teacherLoanDurationDays: 45,
      maxRenewals: 4,
      graceDays: 3,
      finePerOverdueDay: new Prisma.Decimal("5.00"),
      reservationsEnabled: false,
      reservationHoldDurationDays: 5,
      blockBorrowingIfOverdue: false,
    });
    const policy = await getEffectiveLibraryPolicy("s1");
    expect(policy.studentBorrowLimit).toBe(7);
    expect(policy.finePerOverdueDay.toFixed(2)).toBe("5.00");
    expect(policy.reservationsEnabled).toBe(false);
    expect(borrowLimitFor(policy, "STUDENT")).toBe(7);
    expect(borrowLimitFor(policy, "TEACHER")).toBe(9);
    expect(loanDurationDaysFor(policy, "STUDENT")).toBe(21);
    expect(loanDurationDaysFor(policy, "TEACHER")).toBe(45);
  });
});
