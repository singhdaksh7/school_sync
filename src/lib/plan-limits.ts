import { prisma } from "@/lib/prisma";

/**
 * SubscriptionPlan.maxStudents enforcement.
 *
 * "Active students" here means every Student row for the school: the Student
 * model has no soft-delete/archive/status field (see prisma/schema.prisma), so
 * the current record count is the active count. `maxStudents === null` (or no
 * subscription/plan at all) means unlimited — pre-pilot schools without an
 * assigned plan are never capped.
 */

export const STUDENT_LIMIT_MESSAGE = "Student limit reached for the current plan";

export function isUnlimited(maxStudents: number | null | undefined): boolean {
  return maxStudents === null || maxStudents === undefined;
}

/** Pure check: may `adding` more students be created given the current count and cap? */
export function withinStudentLimit(
  currentCount: number,
  adding: number,
  maxStudents: number | null | undefined
): boolean {
  if (isUnlimited(maxStudents)) return true;
  return currentCount + adding <= (maxStudents as number);
}

export type StudentLimitInfo = { maxStudents: number | null; currentCount: number };

/** Resolves the school's effective student cap and its current student count. */
export async function getStudentLimitInfo(schoolId: string): Promise<StudentLimitInfo> {
  const [subscription, currentCount] = await Promise.all([
    prisma.schoolSubscription.findUnique({
      where: { schoolId },
      select: { plan: { select: { maxStudents: true } } },
    }),
    prisma.student.count({ where: { schoolId } }),
  ]);
  return { maxStudents: subscription?.plan?.maxStudents ?? null, currentCount };
}
