/**
 * Smart Timetable — capacity + subject requirement validation (PART 4).
 * Pure/no-DB so it's independently testable; callers pass in the already
 * loaded school/requirement rows.
 */

export type CapacityStatus = "VALID" | "EXCESS_REQUIREMENTS" | "VALID_WITH_UNASSIGNED";

export interface CapacityIssue {
  code: string;
  message: string;
}

export interface CapacityValidationResult {
  capacity: number;
  required: number;
  remaining: number;
  status: CapacityStatus;
  issues: CapacityIssue[];
}

/**
 * Weekly slot capacity = configured working days * periods-per-day. SchoolSync
 * currently models one uniform periodsPerDay for the whole school (no
 * variable per-day period counts in the schema), so that is the actual
 * architecture this multiplies against — see School.timetableWorkingDays /
 * School.periodsPerDay in prisma/schema.prisma.
 */
export function calculateWeeklyCapacity(school: { timetableWorkingDays: number; periodsPerDay: number }): number {
  return school.timetableWorkingDays * school.periodsPerDay;
}

/**
 * Validates a class/section's configured subject weekly-period requirements
 * against its weekly slot capacity. Never returns a bare "invalid" — always a
 * structured result with the exact excess/remaining count.
 */
export function validateSubjectRequirements(
  capacity: number,
  requirements: { subjectName: string; requiredPeriodsPerWeek: number }[]
): CapacityValidationResult {
  const required = requirements.reduce((sum, r) => sum + r.requiredPeriodsPerWeek, 0);
  const remaining = capacity - required;
  const issues: CapacityIssue[] = [];
  let status: CapacityStatus;

  if (remaining < 0) {
    status = "EXCESS_REQUIREMENTS";
    issues.push({
      code: "CAPACITY_EXCEEDED",
      message: `Required weekly periods (${required}) exceed available capacity (${capacity}) by ${-remaining}.`,
    });
  } else if (remaining > 0) {
    status = "VALID_WITH_UNASSIGNED";
    issues.push({
      code: "UNASSIGNED_SLOTS_REMAIN",
      message: `${remaining} weekly slot(s) remain unassigned after configured subject requirements.`,
    });
  } else {
    status = "VALID";
  }

  return { capacity, required, remaining, status, issues };
}
