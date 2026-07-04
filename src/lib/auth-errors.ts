/** Thrown by non-NextAuth login paths (mobile staff/student, parent) to let the
 * calling route distinguish "no account" from "wrong password" in its response. */
export class NoAccountError extends Error {}
export class InvalidPasswordError extends Error {}
/** Thrown when an admission number matches valid students in more than one
 * school and no school context was supplied to disambiguate — the caller should
 * ask the user to log in via their school's portal link. */
export class AmbiguousSchoolError extends Error {}
