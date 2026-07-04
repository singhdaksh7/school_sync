import { describe, it, expect } from "vitest";
import {
  buildStudentFeeAccounts,
  calculateStudentFeeTotals,
  getStudentFeeStatus,
  sumPaidAmounts,
  validateManualPaymentAmount,
} from "@/lib/student-fee-ledger";

describe("student fee ledger calculations", () => {
  it("paid till date sums multiple manual payments", () => {
    const accounts = buildStudentFeeAccounts({
      students: [
        {
          id: "stu1",
          name: "Aarav Sharma",
          rollNo: "12",
          section: { name: "A", class: { id: "class10", name: "10" } },
        },
      ],
      feeStructures: [
        {
          id: "fee1",
          name: "Annual Fee",
          amount: 50000,
          frequency: "ANNUAL",
          classId: "class10",
          class: { id: "class10", name: "10" },
        },
      ],
      payments: [
        { id: "p1", studentId: "stu1", feeStructureId: "fee1", amount: 20000, status: "PAID", createdAt: "2026-06-10" },
        { id: "p2", studentId: "stu1", feeStructureId: "fee1", amount: 10000, status: "PAID", createdAt: "2026-07-04" },
      ],
    });
    expect(accounts[0]?.paidTillDate).toBe(30000);
  });

  it("remaining amount calculates correctly", () => {
    const totals = calculateStudentFeeTotals(50000, 30000);
    expect(totals.remainingAmount).toBe(20000);
  });

  it("UNPAID status when paid till date is zero", () => {
    expect(getStudentFeeStatus(50000, 0)).toBe("UNPAID");
  });

  it("PARTIALLY_PAID status when paid is between zero and total", () => {
    expect(getStudentFeeStatus(50000, 1)).toBe("PARTIALLY_PAID");
    expect(getStudentFeeStatus(50000, 49999)).toBe("PARTIALLY_PAID");
  });

  it("PAID status when paid till date reaches or exceeds total", () => {
    expect(getStudentFeeStatus(50000, 50000)).toBe("PAID");
    expect(getStudentFeeStatus(50000, 60000)).toBe("PAID");
  });

  it("zero payment is rejected", () => {
    expect(validateManualPaymentAmount(0, 50000)).toBe("Payment amount must be greater than zero");
  });

  it("negative payment is rejected", () => {
    expect(validateManualPaymentAmount(-1, 50000)).toBe("Payment amount must be greater than zero");
  });

  it("overpayment is rejected", () => {
    expect(validateManualPaymentAmount(10000, 5000)).toBe("Payment amount exceeds the remaining fee balance");
  });
});

describe("sumPaidAmounts", () => {
  it("sums only PAID entries", () => {
    expect(
      sumPaidAmounts([
        { amount: 1000, status: "PAID" },
        { amount: 2000, status: "FAILED" },
        { amount: 3000, status: "PAID" },
      ])
    ).toBe(4000);
  });
});
