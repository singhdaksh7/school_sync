/**
 * Shared STUDENT leave business rules — the single source of truth consumed
 * by BOTH /api/student/leave (the student themself) and /api/parent/leave (a
 * linked guardian), so the two surfaces can never drift apart on date
 * validation, the same-day cutoff, or how a LeaveRequest row gets created.
 */
import { prisma } from "@/lib/prisma";

const SAME_DAY_CUTOFF_HOUR = 7;
const SAME_DAY_CUTOFF_MINUTE = 30;

export function dateOnly(value: Date) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Same-day leave is only allowed before 7:30 AM local time; after that, only a future date may be requested. */
export function sameDayCutoffPassed(now = new Date()) {
  return now.getHours() > SAME_DAY_CUTOFF_HOUR || (now.getHours() === SAME_DAY_CUTOFF_HOUR && now.getMinutes() >= SAME_DAY_CUTOFF_MINUTE);
}

export type LeaveDateValidation = { ok: true; from: Date; to: Date } | { ok: false; error: string };

/** Validates a requested (fromDate, toDate) pair against the shared student/parent leave rules. */
export function validateStudentLeaveDateRange(fromDate: string, toDate: string, now: Date = new Date()): LeaveDateValidation {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, error: "Invalid date" };
  }
  if (toDate < fromDate) return { ok: false, error: "To date must be on or after from date" };

  const today = dateOnly(now);
  const fromDateOnly = dateOnly(from);
  if (fromDateOnly < today) return { ok: false, error: "Cannot request leave for a past date" };
  if (fromDateOnly.getTime() === today.getTime() && sameDayCutoffPassed(now)) {
    return { ok: false, error: "Same-day leave can only be requested before 7:30 AM. Please choose a future date." };
  }

  return { ok: true, from, to };
}

export interface CreateStudentLeaveInput {
  schoolId: string;
  studentId: string;
  leaveType: string;
  reason: string;
  from: Date;
  to: Date;
}

/** Creates the STUDENT LeaveRequest row — identical shape regardless of whether the caller is the student or a linked guardian. */
export async function createStudentLeaveRequest(input: CreateStudentLeaveInput) {
  return prisma.leaveRequest.create({
    data: {
      type: "STUDENT",
      reason: `${input.leaveType}: ${input.reason}`,
      fromDate: input.from,
      toDate: input.to,
      studentId: input.studentId,
      schoolId: input.schoolId,
    },
    include: { reviewedBy: { select: { name: true } } },
  });
}
