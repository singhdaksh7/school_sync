export const MANUAL_FEE_PAYMENT_METHODS = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"] as const;
export type ManualFeePaymentMethod = (typeof MANUAL_FEE_PAYMENT_METHODS)[number];

export const STUDENT_FEE_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID"] as const;
export type StudentFeeStatus = (typeof STUDENT_FEE_STATUSES)[number];

export type StudentFeeTotals = {
  totalFee: number;
  paidTillDate: number;
  remainingAmount: number;
  status: StudentFeeStatus;
};

export type FeeLedgerStudent = {
  id: string;
  name: string;
  rollNo?: string | null;
  section: { name: string; class: { id: string; name: string } };
};

export type FeeLedgerStructure = {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  classId: string | null;
  class?: { id: string; name: string } | null;
};

export type FeeLedgerPayment = {
  id: string;
  studentId: string;
  feeStructureId: string;
  amount: number;
  status: string;
  paidAt?: Date | string | null;
  createdAt: Date | string;
};

export type StudentFeeAccount<TPayment extends FeeLedgerPayment = FeeLedgerPayment> = {
  key: string;
  studentId: string;
  feeStructureId: string;
  student: FeeLedgerStudent;
  feeStructure: FeeLedgerStructure;
  totalFee: number;
  paidTillDate: number;
  remainingAmount: number;
  status: StudentFeeStatus;
  payments: TPayment[];
};

function normalizeAmount(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function paymentTimestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function isPaidPayment(status: string) {
  return status === "PAID";
}

export function getStudentFeeStatus(totalFee: number, paidTillDate: number): StudentFeeStatus {
  const safeTotal = normalizeAmount(totalFee);
  const safePaid = normalizeAmount(paidTillDate);

  if (safeTotal === 0) return "PAID";
  if (safePaid === 0) return "UNPAID";
  if (safePaid >= safeTotal) return "PAID";
  return "PARTIALLY_PAID";
}

export function calculateStudentFeeTotals(totalFee: number, paidTillDate: number): StudentFeeTotals {
  const safeTotal = normalizeAmount(totalFee);
  const safePaid = normalizeAmount(paidTillDate);
  return {
    totalFee: safeTotal,
    paidTillDate: safePaid,
    remainingAmount: Math.max(safeTotal - safePaid, 0),
    status: getStudentFeeStatus(safeTotal, safePaid),
  };
}

export function sumPaidAmounts<TPayment extends Pick<FeeLedgerPayment, "amount" | "status">>(payments: TPayment[]) {
  return payments.reduce((sum, payment) => {
    if (!isPaidPayment(payment.status)) return sum;
    return sum + normalizeAmount(payment.amount);
  }, 0);
}

export function validateManualPaymentAmount(amount: number, remainingAmount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Payment amount must be greater than zero";
  }
  const safeRemaining = normalizeAmount(remainingAmount);
  if (amount > safeRemaining) {
    return "Payment amount exceeds the remaining fee balance";
  }
  return null;
}

export function buildStudentFeeAccounts<TPayment extends FeeLedgerPayment>({
  students,
  feeStructures,
  payments,
}: {
  students: FeeLedgerStudent[];
  feeStructures: FeeLedgerStructure[];
  payments: TPayment[];
}): StudentFeeAccount<TPayment>[] {
  const paymentsByKey = new Map<string, TPayment[]>();
  for (const payment of payments) {
    const key = `${payment.studentId}:${payment.feeStructureId}`;
    const existing = paymentsByKey.get(key) ?? [];
    existing.push(payment);
    paymentsByKey.set(key, existing);
  }

  for (const accountPayments of paymentsByKey.values()) {
    accountPayments.sort((a, b) => {
      const timeA = paymentTimestamp(a.paidAt ?? a.createdAt);
      const timeB = paymentTimestamp(b.paidAt ?? b.createdAt);
      return timeB - timeA;
    });
  }

  const accounts: StudentFeeAccount<TPayment>[] = [];

  for (const student of students) {
    const classId = student.section.class.id;
    const applicableStructures = feeStructures.filter((structure) => !structure.classId || structure.classId === classId);

    for (const structure of applicableStructures) {
      const key = `${student.id}:${structure.id}`;
      const accountPayments = paymentsByKey.get(key) ?? [];
      const paidTillDate = sumPaidAmounts(accountPayments);
      const totals = calculateStudentFeeTotals(structure.amount, paidTillDate);

      accounts.push({
        key,
        studentId: student.id,
        feeStructureId: structure.id,
        student,
        feeStructure: structure,
        totalFee: totals.totalFee,
        paidTillDate: totals.paidTillDate,
        remainingAmount: totals.remainingAmount,
        status: totals.status,
        payments: accountPayments,
      });
    }
  }

  accounts.sort((a, b) => {
    const studentCmp = a.student.name.localeCompare(b.student.name);
    if (studentCmp !== 0) return studentCmp;
    return a.feeStructure.name.localeCompare(b.feeStructure.name);
  });

  return accounts;
}
