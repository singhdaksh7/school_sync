/** Thrown by non-NextAuth login paths (mobile staff/student, parent) to let the
 * calling route distinguish "no account" from "wrong password" in its response. */
export class NoAccountError extends Error {}
export class InvalidPasswordError extends Error {}
