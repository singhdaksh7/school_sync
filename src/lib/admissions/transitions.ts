import {
  ADMISSION_STATUS_TRANSITIONS,
  DECISION_STATUSES,
  TERMINAL_STATUSES,
  type AdmissionApplicationStatusValue,
} from "@/lib/admissions/constants";

export class AdmissionTransitionError extends Error {
  constructor(
    public readonly code: "ILLEGAL_TRANSITION" | "TERMINAL_STATE" | "REASON_REQUIRED",
    message: string
  ) {
    super(message);
    this.name = "AdmissionTransitionError";
  }
}

/**
 * Validates a proposed status transition against the single source-of-truth
 * map in constants.ts. Throws a typed error on any illegal transition —
 * callers must not fall back to ad-hoc if/else checks.
 */
export function assertLegalTransition(
  from: AdmissionApplicationStatusValue,
  to: AdmissionApplicationStatusValue,
  reason?: string | null
): void {
  if (TERMINAL_STATUSES.has(from)) {
    throw new AdmissionTransitionError("TERMINAL_STATE", `Application is in a terminal state (${from}) and cannot transition further`);
  }
  const allowed = ADMISSION_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AdmissionTransitionError("ILLEGAL_TRANSITION", `Cannot transition from ${from} to ${to}`);
  }
  if (DECISION_STATUSES.has(to) && !reason?.trim()) {
    throw new AdmissionTransitionError("REASON_REQUIRED", `A reason is required to transition to ${to}`);
  }
}

export function isTerminalStatus(status: AdmissionApplicationStatusValue): boolean {
  return TERMINAL_STATUSES.has(status);
}
