/**
 * Certificates & Document Requests v1 — shared constants.
 *
 * Centralized status list + the ONE transition table (single source of
 * truth — never scattered if/else across routes). Mirrors the pattern in
 * src/lib/admissions/constants.ts. Unlike Admissions, each transition here
 * is applied by a dedicated action (approve/reject/issue/revoke/cancel),
 * never a single generic "set status" endpoint — see
 * src/lib/certificates/transitions.ts for the enforcement function every
 * one of those actions must call before writing.
 */

export const CERTIFICATE_TYPES = [
  "BONAFIDE",
  "TRANSFER_CERTIFICATE",
  "CHARACTER_CERTIFICATE",
  "STUDY_CERTIFICATE",
  "CUSTOM",
] as const;
export type CertificateTypeValue = (typeof CERTIFICATE_TYPES)[number];

export const CERTIFICATE_REQUEST_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "ISSUED",
  "REVOKED",
  "CANCELLED",
] as const;
export type CertificateRequestStatusValue = (typeof CERTIFICATE_REQUEST_STATUSES)[number];

export const CERTIFICATE_REQUESTER_TYPES = ["STUDENT", "GUARDIAN", "STAFF"] as const;
export type CertificateRequesterTypeValue = (typeof CERTIFICATE_REQUESTER_TYPES)[number];

export const TERMINAL_STATUSES = new Set<CertificateRequestStatusValue>(["REJECTED", "REVOKED", "CANCELLED"]);

/**
 * Statuses a requester (the student who owns the request, or the guardian/
 * staff member who filed it) may cancel FROM. Deliberately narrower than
 * what staff can do: once a request is APPROVED, cancelling is a staff-only
 * action (see requireCancelWrite in authorization.ts) since a reviewer has
 * already committed a decision. ISSUED is never cancellable — see REVOKED.
 */
export const REQUESTER_CANCELLABLE_STATUSES = new Set<CertificateRequestStatusValue>(["PENDING", "UNDER_REVIEW"]);

/** Statuses staff with cancel authority may cancel from (superset of the requester's). */
export const STAFF_CANCELLABLE_STATUSES = new Set<CertificateRequestStatusValue>(["PENDING", "UNDER_REVIEW", "APPROVED"]);

/** The single source of truth for legal request-status transitions. */
export const CERTIFICATE_REQUEST_TRANSITIONS: Record<CertificateRequestStatusValue, CertificateRequestStatusValue[]> = {
  PENDING: ["UNDER_REVIEW", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ISSUED", "CANCELLED"],
  REJECTED: [],
  ISSUED: ["REVOKED"],
  REVOKED: [],
  CANCELLED: [],
};

// Repo upload policy for certificate template branding assets — mirrors
// REPORT_CARD_ASSET (see src/lib/upload-validation.ts).
export const CERTIFICATE_TEMPLATE_ASSET_MAX_BYTES = 3 * 1024 * 1024; // 3MB

// Free-text bounds shared by validation.ts and the migration's CHECKs.
export const CERTIFICATE_PURPOSE_MAX_LEN = 500;
export const CERTIFICATE_CUSTOM_LABEL_MAX_LEN = 120;
export const CERTIFICATE_REVIEW_NOTE_MAX_LEN = 1000;
export const CERTIFICATE_REVOKE_REASON_MAX_LEN = 1000;
