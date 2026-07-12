/**
 * Decides which NextAuth credentials provider the unified /login form should
 * call, based purely on the shape of what the user typed in the single
 * identifier field — never a role they selected. This is a format check, not
 * an authorization decision — both providers independently re-verify the
 * password and resolve the account's real role server-side regardless of
 * which one is called.
 *
 * COVERAGE — what the unified web login currently supports, and nothing more:
 *   - School Owner, School Admin, Vice Principal (Principal), Teacher:
 *     email only, verified against User.email (src/lib/auth-web.ts,
 *     authenticateStaffForWeb). This is the *only* identifier these roles
 *     have ever supported for web login — there is no staff phone-number
 *     web login anywhere in this codebase to preserve.
 *   - Student: admission number only, verified against Student.admissionNo
 *     (src/lib/mobile-auth.ts, authenticateStudentForMobile). Student.email
 *     exists as an optional field on the model but is NOT — and never was —
 *     accepted as a login identifier by the student-credentials provider;
 *     only admissionNo is queried. Do not assume email-login works for
 *     students just because the field exists on the model.
 *   - Guardian/Parent: NOT covered by this page or this function at all.
 *     Guardian login is phone-number-based but lives entirely outside
 *     NextAuth (src/lib/parent-auth.ts, POST /api/parent/login, mobile/API
 *     JWT only) — there is no web session type for guardians to route to,
 *     so unifying it here would mean inventing a new web portal, not
 *     wiring up an existing one. Left untouched.
 *   - Founder: intentionally NEVER reachable through this function or this
 *     page — Founder has its own separate page (/founder/login) and its own
 *     provider (founder-credentials, src/lib/auth-providers.ts) by design.
 *
 * Format rule: an identifier containing "@" is treated as staff (email);
 * anything else is treated as a student admission number. This exactly
 * mirrors the pre-existing, independently-supported identifier shapes for
 * each provider (email for staff, admission number for students) — no new
 * identifier format is introduced.
 *
 * KNOWN EDGE CASE (documented, not fixed here): nothing in this codebase's
 * student-creation/import paths currently forbids an admission number from
 * containing "@". If a school ever assigned one that did, it would be
 * misrouted to the staff provider and rejected there as "no account" (a
 * confusing but NOT a security-relevant failure — no cross-account access
 * results, authenticateStaffForWeb still requires a valid User.email match).
 * If this becomes a real problem, the fix belongs in admission-number
 * validation at creation/import time, not in this format check.
 */
export type LoginIdentifierKind = "staff" | "student";

export function detectLoginIdentifierKind(identifier: string): LoginIdentifierKind {
  return identifier.includes("@") ? "staff" : "student";
}
