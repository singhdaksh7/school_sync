/**
 * Admissions Management v1 — shared constants.
 *
 * Centralized status list + the ONE transition table (single source of
 * truth — never scattered if/else across routes). See transitions.ts for the
 * enforcement function built on top of this map.
 */

export const ADMISSION_APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "DOCUMENTS_PENDING",
  "INTERVIEW_SCHEDULED",
  "ASSESSMENT_SCHEDULED",
  "WAITLISTED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "ENROLLED",
] as const;

export type AdmissionApplicationStatusValue = (typeof ADMISSION_APPLICATION_STATUSES)[number];

export const TERMINAL_STATUSES = new Set<AdmissionApplicationStatusValue>(["REJECTED", "WITHDRAWN", "ENROLLED"]);

/**
 * Transitions that are "decisions" and therefore require a mandatory,
 * non-empty reason string supplied by the caller (audited on the
 * AdmissionStatusHistory row).
 */
export const DECISION_STATUSES = new Set<AdmissionApplicationStatusValue>([
  "WAITLISTED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);

/** The single source of truth for legal status transitions. */
export const ADMISSION_STATUS_TRANSITIONS: Record<AdmissionApplicationStatusValue, AdmissionApplicationStatusValue[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["UNDER_REVIEW", "DOCUMENTS_PENDING", "WITHDRAWN"],
  UNDER_REVIEW: [
    "DOCUMENTS_PENDING",
    "INTERVIEW_SCHEDULED",
    "ASSESSMENT_SCHEDULED",
    "WAITLISTED",
    "APPROVED",
    "REJECTED",
    "WITHDRAWN",
  ],
  DOCUMENTS_PENDING: ["UNDER_REVIEW", "WITHDRAWN"],
  INTERVIEW_SCHEDULED: ["UNDER_REVIEW", "WAITLISTED", "APPROVED", "REJECTED", "WITHDRAWN"],
  ASSESSMENT_SCHEDULED: ["UNDER_REVIEW", "WAITLISTED", "APPROVED", "REJECTED", "WITHDRAWN"],
  WAITLISTED: ["UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"],
  APPROVED: ["ENROLLED", "WITHDRAWN"],
  REJECTED: [],
  WITHDRAWN: [],
  ENROLLED: [],
};

export const ADMISSION_DOCUMENT_VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;
export const ADMISSION_REVIEW_EVENT_TYPES = ["INTERVIEW", "ASSESSMENT"] as const;
export const ADMISSION_REVIEW_EVENT_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export const ADMISSION_NOTE_TYPES = ["INTERNAL", "APPLICANT_VISIBLE"] as const;
export const ADMISSION_CYCLE_STATUSES = ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as const;

// Repo upload policy for admission documents — mirrors the size ceiling used
// elsewhere in the codebase for tenant-private attachments (see
// src/lib/storage.ts docs); MIME allow-list kept intentionally narrow for
// admissions documents (ID proofs, mark sheets, photos).
export const ADMISSION_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const ADMISSION_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
