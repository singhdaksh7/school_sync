// Central route → feature entitlement registry.
//
// This is a DOCUMENTATION + AUDIT layer, NOT a runtime security layer. The real
// enforcement lives in each route handler, which calls `requireSchoolFeature`
// (see src/lib/feature-flags.ts) with the school id derived from the verified
// auth/identity context. This registry exists so that:
//   1. Every plan-gated feature key has an explicit, reviewable route-family map.
//   2. A static test (tests/feature-route-enforcement.test.ts) can walk every
//      API route file and prove the matching gate is present — catching the
//      "developer adds a nested route and forgets the flag" regression.
//
// It must never be used as a URL-substring middleware that pretends to enforce
// features: substring matching is not tenant-aware and cannot derive the school.

import { FEATURE_FLAG_KEYS, type FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

/**
 * Feature keys that gate a concrete server-side module. Each maps to one or more
 * API route families that MUST call requireSchoolFeature with this key.
 */
export const MODULE_FEATURE_KEYS = [
  "ATTENDANCE",
  "HOMEWORK",
  "FEES",
  "REPORT_CARDS",
  "REPORT_CARD_BUILDER",
  "ANALYTICS",
  "TEACHER_PERMISSIONS",
  "AI_FEATURES",
  "NOTEBOOK_CHECKING",
  "WHITE_LABEL",
] as const satisfies readonly FeatureFlagKeyValue[];

/**
 * Feature keys that are access-channel / delivery flags rather than a distinct
 * server-side data module. They are enforced (if at all) at the login/channel or
 * UI layer, NOT per data-route, and are deliberately NOT gated inside the
 * content routes — gating them there would amount to feature-gating
 * authentication itself, which is explicitly out of scope. Documented here so
 * every catalog key has an explicit decision.
 */
export const NON_MODULE_FEATURE_KEYS: Record<
  Extract<FeatureFlagKeyValue, "MOBILE_APP" | "PARENT_PORTAL" | "STUDENT_PORTAL" | "NOTIFICATIONS">,
  string
> = {
  MOBILE_APP:
    "Access channel (native app availability). Gating it would gate mobile login/auth, which is out of scope; no dedicated data-module route exists.",
  PARENT_PORTAL:
    "Access channel (parent portal availability). The individual parent data routes are each gated by their own content module (HOMEWORK, ATTENDANCE, FEES, REPORT_CARDS). Gating the portal itself would gate parent login/auth.",
  STUDENT_PORTAL:
    "Access channel (student portal availability). The individual student data routes are each gated by their own content module. Gating the portal itself would gate student login/auth.",
  NOTIFICATIONS:
    "Delivery channel. No active school-facing notification-dispatch API route exists in this codebase (founder notifications are platform-admin), so there is no server business operation to gate.",
};

type RouteRule = { pattern: RegExp; feature: FeatureFlagKeyValue };

/**
 * Ordered classification rules over the API route path (relative to
 * `src/app/api/`, forward slashes, literal `[param]` segments, no trailing
 * `/route.ts`). First match wins, so more specific rules come first.
 */
export const FEATURE_ROUTE_RULES: RouteRule[] = [
  // ── FEES (student school fees only — NOT SaaS billing) ──────────────────────
  { pattern: /^schools\/\[schoolId\]\/fee-structures(\/|$)/, feature: "FEES" },
  { pattern: /^schools\/\[schoolId\]\/fee-payments(\/|$)/, feature: "FEES" },
  { pattern: /^parent\/fees\/\[paymentId\]\/receipt$/, feature: "FEES" },
  { pattern: /^parent\/fees$/, feature: "FEES" },

  // ── REPORT_CARD_BUILDER (the template builder) ──────────────────────────────
  { pattern: /^schools\/\[schoolId\]\/report-card-templates(\/|$)/, feature: "REPORT_CARD_BUILDER" },

  // ── REPORT_CARDS (generation / reads / publish / pdf) ───────────────────────
  { pattern: /^schools\/\[schoolId\]\/report-cards(\/|$)/, feature: "REPORT_CARDS" },
  { pattern: /^schools\/\[schoolId\]\/students\/\[studentId\]\/report-card$/, feature: "REPORT_CARDS" },
  { pattern: /^teacher\/report-cards(\/|$)/, feature: "REPORT_CARDS" },
  { pattern: /^parent\/report-cards(\/|$)/, feature: "REPORT_CARDS" },
  { pattern: /^student\/report-cards$/, feature: "REPORT_CARDS" },

  // ── HOMEWORK ────────────────────────────────────────────────────────────────
  { pattern: /^schools\/\[schoolId\]\/homework(\/|$)/, feature: "HOMEWORK" },
  { pattern: /^schools\/\[schoolId\]\/students\/\[studentId\]\/homework-summary$/, feature: "HOMEWORK" },
  { pattern: /^teacher\/homework(\/|$)/, feature: "HOMEWORK" },
  { pattern: /^parent\/homework(\/|$)/, feature: "HOMEWORK" },
  { pattern: /^student\/homework(-summary)?$/, feature: "HOMEWORK" },

  // ── TEACHER_PERMISSIONS (custom RBAC management + self-introspection) ────────
  { pattern: /^schools\/\[schoolId\]\/teacher-roles(\/|$)/, feature: "TEACHER_PERMISSIONS" },
  { pattern: /^schools\/\[schoolId\]\/teachers\/\[teacherId\]\/permissions$/, feature: "TEACHER_PERMISSIONS" },
  { pattern: /^schools\/\[schoolId\]\/teachers\/\[teacherId\]\/roles(\/|$)/, feature: "TEACHER_PERMISSIONS" },
  { pattern: /^teacher\/permissions$/, feature: "TEACHER_PERMISSIONS" },

  // ── NOTEBOOK_CHECKING (exam milestones ARE the notebook-check milestones; ────
  //    exam-milestone analytics is notebook-completion data, not the ANALYTICS
  //    dashboard) ────────────────────────────────────────────────────────────
  { pattern: /^schools\/\[schoolId\]\/exam-milestones(\/|$)/, feature: "NOTEBOOK_CHECKING" },
  { pattern: /^teacher\/exam-milestones$/, feature: "NOTEBOOK_CHECKING" },
  { pattern: /^teacher\/notebook$/, feature: "NOTEBOOK_CHECKING" },
  { pattern: /^student\/notebook$/, feature: "NOTEBOOK_CHECKING" },

  // ── ANALYTICS (school dashboard analytics only; Founder revenue is exempt) ───
  { pattern: /^schools\/\[schoolId\]\/analytics$/, feature: "ANALYTICS" },

  // ── AI_FEATURES (actual LLM-backed endpoints only) ──────────────────────────
  { pattern: /^ai-insights$/, feature: "AI_FEATURES" },

  // ── ATTENDANCE ──────────────────────────────────────────────────────────────
  { pattern: /^schools\/\[schoolId\]\/attendance(\/|$)/, feature: "ATTENDANCE" },
  { pattern: /^schools\/\[schoolId\]\/settings\/attendance$/, feature: "ATTENDANCE" },
  { pattern: /^teacher\/attendance(\/|$)/, feature: "ATTENDANCE" },
  { pattern: /^parent\/attendance$/, feature: "ATTENDANCE" },
  { pattern: /^student\/attendance$/, feature: "ATTENDANCE" },

  // ── WHITE_LABEL (per-school branding config; the public /api/branding tenant
  //    resolver is intentionally NOT gated) ────────────────────────────────────
  { pattern: /^schools\/\[schoolId\]\/branding(\/|$)/, feature: "WHITE_LABEL" },
];

/**
 * Routes deliberately left ungated, with the security/business rationale. These
 * are the platform/system exemptions the audit test treats as intentionally
 * NOT feature-gated. (Anything not matched by a rule and not listed here is a
 * plain non-feature CRUD route — e.g. classes, subjects, results, timetable —
 * for which no plan feature key exists in the catalog.)
 */
export const EXEMPT_ROUTE_RATIONALES: { pattern: RegExp; reason: string }[] = [
  { pattern: /^founder\//, reason: "Founder control plane: must manage any school regardless of that school's feature flags (guarded by requireFounderSession)." },
  { pattern: /^schools\/\[schoolId\]\/payment-proofs(\/|$)/, reason: "SaaS billing recovery (incl. the receipt upload sub-route): a suspended/expired school must still submit payment proof to be reinstated." },
  { pattern: /^schools\/\[schoolId\]\/invoices$/, reason: "SaaS billing (SchoolSync subscription invoices), a separate domain from student FEES." },
  { pattern: /^auth\//, reason: "Authentication must never be feature-gated." },
  { pattern: /^mobile\/(staff|student)\/login$/, reason: "Login endpoint — not feature-gated." },
  { pattern: /^parent\/login$/, reason: "Parent login — not feature-gated." },
  { pattern: /^(invite|teacher-invite)\//, reason: "Invite acceptance — no catalog rule gates it." },
  { pattern: /^schools\/\[schoolId\]\/invites(\/|$)/, reason: "Staff invite management — governed by RBAC, no feature key." },
  { pattern: /^branding$/, reason: "Public tenant branding resolution for login pages — must stay open even when other modules are off." },
  { pattern: /^school-by-slug\//, reason: "Public tenant resolution." },
  { pattern: /^health$/, reason: "Health probe." },
  { pattern: /^webhooks\//, reason: "External webhook integrity; no active student-fee gateway remains." },
  { pattern: /^parent\/fees\/(create-order|verify-payment)$/, reason: "Retired online student-fee payment stubs — return HTTP 410 regardless of FEES state." },
  { pattern: /^files\/\[fileId\]$/, reason: "Cross-cutting managed-file access route; authorization is by StoredFile visibility/category (see src/lib/storage.ts), not a single catalog feature." },
  { pattern: /^schools\/\[schoolId\]\/jobs(\/|$)/, reason: "Job listing/detail/cancel is infra, not a plan feature; the job TYPE is gated at creation time (e.g. REPORT_CARD_BATCH_GENERATION requires REPORT_CARDS at the teacher/report-cards/generate call site)." },
  { pattern: /^internal\//, reason: "Internal worker endpoint, authenticated by JOB_WORKER_SECRET — never reachable by a school user." },
];

/** First-match classification of an API route path to its gating feature, or null. */
export function classifyRoute(routePath: string): FeatureFlagKeyValue | null {
  for (const rule of FEATURE_ROUTE_RULES) {
    if (rule.pattern.test(routePath)) return rule.feature;
  }
  return null;
}

/** True when the route path is an explicitly-documented platform/system exemption. */
export function isExemptRoute(routePath: string): boolean {
  return EXEMPT_ROUTE_RATIONALES.some((r) => r.pattern.test(routePath));
}

// Compile-time guard: every module + non-module key is a real catalog key, and
// together they account for EVERY feature flag key (explicit decision for each).
const _allDecided: Record<FeatureFlagKeyValue, true> = {
  ...(Object.fromEntries(MODULE_FEATURE_KEYS.map((k) => [k, true])) as Record<string, true>),
  ...(Object.fromEntries(Object.keys(NON_MODULE_FEATURE_KEYS).map((k) => [k, true])) as Record<string, true>),
} as Record<FeatureFlagKeyValue, true>;
void _allDecided;
void FEATURE_FLAG_KEYS;
