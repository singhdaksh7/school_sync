// Pure data — no server-only imports — so this is safe to import from
// client components. src/lib/feature-flags.ts (server-only, uses Prisma)
// re-exports everything here for server-side consumers.

export const FEATURE_FLAG_KEYS = [
  "ATTENDANCE",
  "HOMEWORK",
  "FEES",
  "REPORT_CARDS",
  "REPORT_CARD_BUILDER",
  "MOBILE_APP",
  "PARENT_PORTAL",
  "STUDENT_PORTAL",
  "NOTIFICATIONS",
  "ANALYTICS",
  "WHITE_LABEL",
  "TEACHER_PERMISSIONS",
  "AI_FEATURES",
] as const;

export type FeatureFlagKeyValue = (typeof FEATURE_FLAG_KEYS)[number];

export const FEATURE_FLAG_LABELS: Record<FeatureFlagKeyValue, string> = {
  ATTENDANCE: "Attendance",
  HOMEWORK: "Homework",
  FEES: "Fees",
  REPORT_CARDS: "Report Cards",
  REPORT_CARD_BUILDER: "Report Card Builder",
  MOBILE_APP: "Mobile App",
  PARENT_PORTAL: "Parent Portal",
  STUDENT_PORTAL: "Student Portal",
  NOTIFICATIONS: "Notifications",
  ANALYTICS: "Analytics",
  WHITE_LABEL: "White Label",
  TEACHER_PERMISSIONS: "Teacher Permissions",
  AI_FEATURES: "AI Features",
};

export const FEATURE_FLAG_GROUPS: { label: string; keys: FeatureFlagKeyValue[] }[] = [
  {
    label: "Core Academic",
    keys: ["ATTENDANCE", "HOMEWORK", "FEES", "REPORT_CARDS", "REPORT_CARD_BUILDER"],
  },
  {
    label: "Access Channels",
    keys: ["MOBILE_APP", "PARENT_PORTAL", "STUDENT_PORTAL"],
  },
  {
    label: "Platform",
    keys: ["NOTIFICATIONS", "ANALYTICS", "WHITE_LABEL", "TEACHER_PERMISSIONS", "AI_FEATURES"],
  },
];
