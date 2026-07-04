import crypto from "crypto";

/**
 * Invite tokens are never stored in plaintext. The raw token goes into the
 * email/link; only its SHA-256 hash is persisted (in the `tokenHash` column of
 * SchoolInvite / TeacherInvite). Lookup hashes the incoming raw token and
 * matches on the stored hash — mirroring the password-reset token pattern in
 * src/lib/password-reset.ts.
 *
 * Because only the hash is stored, a leaked/rotated raw token cannot be
 * reconstructed from the database, and existing pre-migration rows (whose
 * tokenHash is null) are automatically unusable via the hashed lookup.
 */

export function hashInviteToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Generates a fresh high-entropy raw token and its stored hash. */
export function generateInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashInviteToken(rawToken) };
}
