/**
 * Certificate domain events (spec §15). This branch must NOT implement
 * Notification rows, notification jobs, FCM, email, SMS or WhatsApp — that
 * is Unified Notifications' concern, developed in a parallel branch this one
 * must not depend on. These hooks exist so that future integration point can
 * subscribe without this module ever importing anything from that branch.
 *
 * Today `emitCertificateEvent` only logs (dev-visibility) — every call site
 * already writes an audit-log entry separately via src/lib/audit.ts, so no
 * event is silently lost even though nothing else consumes this yet.
 */

export type CertificateDomainEvent =
  | { type: "REQUEST_SUBMITTED"; schoolId: string; requestId: string; studentId: string }
  | { type: "REQUEST_APPROVED"; schoolId: string; requestId: string; studentId: string }
  | { type: "REQUEST_REJECTED"; schoolId: string; requestId: string; studentId: string }
  | { type: "CERTIFICATE_ISSUED"; schoolId: string; requestId: string; studentId: string; issuedCertificateId: string }
  | { type: "CERTIFICATE_REVOKED"; schoolId: string; issuedCertificateId: string; studentId: string };

export type CertificateEventListener = (event: CertificateDomainEvent) => void;

const listeners: CertificateEventListener[] = [];

/** Registration point for a future Notifications integration. Not used by this branch. */
export function onCertificateEvent(listener: CertificateEventListener): void {
  listeners.push(listener);
}

export function emitCertificateEvent(event: CertificateDomainEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error("[certificates] event listener failed", event.type, err);
    }
  }
}
