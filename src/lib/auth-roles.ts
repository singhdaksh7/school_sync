/**
 * Shared role-set constants for web and mobile authentication.
 *
 * Deliberately dependency-free: no imports from any auth provider (auth.ts,
 * auth-web.ts), NextAuth configuration (auth.config.ts), or database module
 * (prisma.ts, mobile-auth.ts, etc). This file must stay a leaf in the import
 * graph — anything else in src/lib/auth* or src/lib/mobile-auth.ts may import
 * from here, but this file must never import from any of them, or the cycle
 * it exists to remove comes right back.
 */

/** Roles allowed to authenticate as school staff (web `credentials` provider
 * and mobile staff login). Deliberately excludes FOUNDER and STUDENT — both
 * have their own dedicated login paths. */
export const STAFF_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL", "TEACHER"]);
