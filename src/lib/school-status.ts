export const SCHOOL_STATUSES = ["ACTIVE", "TRIAL", "EXPIRED", "SUSPENDED"] as const;
export type SchoolStatusValue = (typeof SCHOOL_STATUSES)[number];

export const SCHOOL_STATUS_LABEL: Record<SchoolStatusValue, string> = {
  ACTIVE: "Active",
  TRIAL: "Trial",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
};

// EXPIRED is a lapsed/likely-to-renew state (secondary, low alarm); SUSPENDED
// is a deliberate block (destructive, high alarm).
export const SCHOOL_STATUS_BADGE_VARIANT: Record<
  SchoolStatusValue,
  "success" | "warning" | "secondary" | "destructive"
> = {
  ACTIVE: "success",
  TRIAL: "warning",
  EXPIRED: "secondary",
  SUSPENDED: "destructive",
};
