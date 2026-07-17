import {
  CERTIFICATE_REQUEST_TRANSITIONS,
  TERMINAL_STATUSES,
  type CertificateRequestStatusValue,
} from "@/lib/certificates/constants";

export class CertificateTransitionError extends Error {
  constructor(
    public readonly code: "ILLEGAL_TRANSITION" | "TERMINAL_STATE" | "REASON_REQUIRED",
    message: string
  ) {
    super(message);
    this.name = "CertificateTransitionError";
  }
}

/**
 * Validates a proposed status transition against the single source-of-truth
 * map in constants.ts. Throws a typed error on any illegal transition —
 * every dedicated action (review/approve/reject/issue/revoke/cancel) must
 * call this before writing, never re-implement the check inline.
 */
export function assertLegalTransition(
  from: CertificateRequestStatusValue,
  to: CertificateRequestStatusValue
): void {
  if (TERMINAL_STATUSES.has(from)) {
    throw new CertificateTransitionError(
      "TERMINAL_STATE",
      `Request is in a terminal state (${from}) and cannot transition further`
    );
  }
  const allowed = CERTIFICATE_REQUEST_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new CertificateTransitionError("ILLEGAL_TRANSITION", `Cannot transition from ${from} to ${to}`);
  }
}

export function isTerminalStatus(status: CertificateRequestStatusValue): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Idempotency guard for repeated transition requests (spec rule 10: "Repeated
 * transition requests must not apply twice"). Callers pass the CURRENT status
 * and the status the caller is trying to reach; if the request is already in
 * that exact target status, the action is a no-op success rather than an
 * ILLEGAL_TRANSITION error — this makes issue/revoke/approve/reject safe to
 * retry after a client-side timeout without double-applying side effects
 * (double file generation, double counter increment, etc).
 */
export function isAlreadyInTargetState(
  current: CertificateRequestStatusValue,
  target: CertificateRequestStatusValue
): boolean {
  return current === target;
}
