import { Prisma } from "@/generated/prisma/client";
import { resolveSchoolLocalNow } from "@/lib/school-time";
import type { EffectiveLibraryPolicy } from "@/lib/library/policy";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKeyToUtc(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole calendar days a loan is past due, measured in the SCHOOL's timezone
 * (never the server's). `reference` is the return instant (or "now" for an
 * open loan). Returns 0 when not yet due. Grace days are applied later at the
 * fine step, not here — this is the raw overdue-day count.
 */
export function overdueDays(dueAt: Date, reference: Date, timezone: string): number {
  const dueKey = resolveSchoolLocalNow(timezone, dueAt).dateKey;
  const refKey = resolveSchoolLocalNow(timezone, reference).dateKey;
  const diff = Math.round((dateKeyToUtc(refKey) - dateKeyToUtc(dueKey)) / DAY_MS);
  return diff > 0 ? diff : 0;
}

/** True when the loan is currently overdue (past due date in school tz). */
export function isOverdue(dueAt: Date, reference: Date, timezone: string): boolean {
  return overdueDays(dueAt, reference, timezone) > 0;
}

/**
 * Deterministic fine, computed entirely with Prisma.Decimal (never a JS float):
 *   fine = finePerOverdueDay * max(0, overdueDays - graceDays)
 * Returns a Decimal with the same 2-dp scale as the money columns.
 */
export function computeFine(
  dueAt: Date,
  reference: Date,
  timezone: string,
  policy: Pick<EffectiveLibraryPolicy, "finePerOverdueDay" | "graceDays">
): Prisma.Decimal {
  const raw = overdueDays(dueAt, reference, timezone);
  const chargeable = Math.max(0, raw - policy.graceDays);
  return new Prisma.Decimal(policy.finePerOverdueDay).mul(chargeable);
}
