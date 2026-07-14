import type { SchoolStatus } from "@/generated/prisma/client";

// Selectable via the generic Founder status dropdown (SchoolStatusControl /
// PATCH .../status). Deliberately EXCLUDES the deletion-lifecycle states
// (PENDING_DELETION/DELETING/DELETION_FAILED/DELETED) — those are only ever
// written by src/lib/school-deletion.ts's dedicated, re-auth-gated
// endpoints, never mass-assignable through this generic control.
export const SCHOOL_STATUSES = ["ACTIVE", "TRIAL", "EXPIRED", "SUSPENDED"] as const;
export type SchoolStatusValue = (typeof SCHOOL_STATUSES)[number];

// Display-only maps cover the FULL lifecycle enum (including the
// deletion-lifecycle states) since any school detail/list view may need to
// render one, even though it can never be *selected* via SCHOOL_STATUSES above.
export const SCHOOL_STATUS_LABEL: Record<SchoolStatus, string> = {
  ACTIVE: "Active",
  TRIAL: "Trial",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  PENDING_DELETION: "Pending Deletion",
  DELETING: "Deleting",
  DELETION_FAILED: "Deletion Failed",
  DELETED: "Deleted",
};

// EXPIRED is a lapsed/likely-to-renew state (secondary, low alarm); SUSPENDED
// and the deletion-lifecycle states are deliberate blocks (destructive, high alarm).
export const SCHOOL_STATUS_BADGE_VARIANT: Record<
  SchoolStatus,
  "success" | "warning" | "secondary" | "destructive"
> = {
  ACTIVE: "success",
  TRIAL: "warning",
  EXPIRED: "secondary",
  SUSPENDED: "destructive",
  PENDING_DELETION: "destructive",
  DELETING: "destructive",
  DELETION_FAILED: "destructive",
  DELETED: "secondary",
};
