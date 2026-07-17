import crypto from "crypto";

/**
 * Public QR-verification tokens are never stored in plaintext — only their
 * SHA-256 hash is persisted (IssuedCertificate.verificationTokenHash), same
 * pattern as src/lib/invite-tokens.ts. The raw token is embedded in the
 * certificate's QR code / verification URL at issuance time and is
 * unrecoverable from the database afterward.
 */

export function hashVerificationToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Generates a fresh high-entropy raw token and its stored hash. */
export function generateVerificationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(24).toString("base64url");
  return { rawToken, tokenHash: hashVerificationToken(rawToken) };
}
