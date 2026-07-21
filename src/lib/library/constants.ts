/**
 * Library Management v1 — shared constants.
 *
 * The effective policy for a school is a LibraryPolicy row, or these defaults
 * when no row exists yet (mirrors the "absence means enabled default" pattern
 * used by feature flags). Defaults match the product spec.
 */

export const DEFAULT_LIBRARY_POLICY = {
  studentBorrowLimit: 3,
  teacherBorrowLimit: 5,
  studentLoanDurationDays: 14,
  teacherLoanDurationDays: 30,
  maxRenewals: 2,
  graceDays: 1,
  finePerOverdueDay: "2.00",
  reservationsEnabled: true,
  reservationHoldDurationDays: 2,
  blockBorrowingIfOverdue: true,
} as const;

/** Granular delegated capabilities (PERMISSION_CATALOG.LIBRARY actions). */
export const LIBRARY_CAPABILITIES = [
  "VIEW",
  "CATALOGUE_MANAGE",
  "COPY_MANAGE",
  "ISSUE",
  "RETURN",
  "RENEW",
  "RESERVATION_MANAGE",
  "FINE_WAIVE",
  "POLICY_MANAGE",
  "REPORT_VIEW",
] as const;

export type LibraryCapability = (typeof LIBRARY_CAPABILITIES)[number];

/** Copy status values a copy may be moved to via the manual status-change API. */
export const MANUAL_COPY_STATUSES = ["AVAILABLE", "LOST", "DAMAGED", "UNDER_REPAIR", "WITHDRAWN"] as const;
