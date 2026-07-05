/**
 * Teacher Operations Head & Automatic Delegation (Phase 3) — the centralized
 * TEACHER_OPERATIONS capability bundle (PART 10). One list, consulted by
 * `operational-authorization.ts`'s `canManageTeacherOperations` — never
 * scattered `if (isOperationsHead) allow` checks across route files.
 *
 * Reuse audit (PART 10 requirement — reuse existing permission keys where
 * semantically exact):
 *   - TEACHER_LEAVE_VIEW / APPROVE / REJECT reuse the EXISTING
 *     `PERMISSION_CATALOG.LEAVE` catalog ("VIEW"/"APPROVE") already consumed
 *     by /schools/[schoolId]/leaves routes — APPROVE and REJECT are the same
 *     underlying mutation/permission there today (one PATCH endpoint, one
 *     "LEAVE":"APPROVE" check, for either resulting status).
 *   - ARRANGEMENTS_MANAGE / SUBSTITUTIONS_ASSIGN / UNCOVERED_LECTURES_MANAGE
 *     reuse the EXISTING `PERMISSION_CATALOG.TEACHERS` catalog action
 *     "ASSIGN_SUBSTITUTIONS" — defined in the catalog but not yet consulted
 *     by any route before this phase (Arrangement is the canonical model;
 *     there is no separate Substitution model — see arrangements.ts audit).
 *     All three names describe the SAME real action (assign/generate an
 *     Arrangement) exposed under the vocabulary this phase's spec requested;
 *     they are aliases, not three independent authorization paths.
 *   - ARRANGEMENTS_VIEW / SUBSTITUTIONS_VIEW / UNCOVERED_LECTURES_VIEW are
 *     likewise aliases of one read capability.
 *   - Every remaining *_VIEW capability (Operations Command Center reads)
 *     and TEACHER_ATTENDANCE_MANAGE have NO existing catalog equivalent —
 *     Phase 2 denied TEACHER entirely from `/operations/*`, and there is no
 *     "manage another teacher's daily attendance status" action anywhere in
 *     PERMISSION_CATALOG. These are genuine new operational-only
 *     capabilities: grantable ONLY via effective TEACHER_OPERATIONS
 *     delegation, never via a base TeacherCustomRole (this phase does not
 *     extend the base custom-role catalog — only the narrow operational
 *     bundle exists for these).
 */

export const TEACHER_OPERATIONS_CAPABILITIES = [
  "OPERATIONS_TODAY_VIEW",
  "TEACHER_STATUS_VIEW",
  "TEACHER_ATTENDANCE_MANAGE",
  "TEACHER_LEAVE_VIEW",
  "TEACHER_LEAVE_APPROVE",
  "TEACHER_LEAVE_REJECT",
  "ARRANGEMENTS_VIEW",
  "ARRANGEMENTS_MANAGE",
  "SUBSTITUTIONS_VIEW",
  "SUBSTITUTIONS_ASSIGN",
  "UNCOVERED_LECTURES_VIEW",
  "UNCOVERED_LECTURES_MANAGE",
  "CURRENT_PERIOD_VIEW",
  "NEXT_PERIOD_RISK_VIEW",
  "TEACHER_WORKLOAD_VIEW",
  "DAILY_OPERATIONS_SUMMARY_VIEW",
] as const;

export type TeacherOperationsCapability = (typeof TEACHER_OPERATIONS_CAPABILITIES)[number];

export function isTeacherOperationsCapability(value: unknown): value is TeacherOperationsCapability {
  return (TEACHER_OPERATIONS_CAPABILITIES as readonly string[]).includes(value as string);
}

/**
 * Capabilities NOT covered by the operational bundle by default — explicitly
 * denied unless an existing, independent teacher permission separately
 * grants them (PART 13/27). Documented here (not enforced here) so route
 * authors have one place to check intent; enforcement lives in each route's
 * own guard, since financial/administrative data lives behind its own
 * existing authorization, not this bundle.
 */
export const OPERATIONS_HEAD_DENIED_BY_DEFAULT = [
  "FEE_TODAY_INSIGHTS",
  "EXAM_ADMINISTRATIVE_PROGRESS",
  "REPORT_CARD_ADMINISTRATIVE_PROGRESS",
] as const;
