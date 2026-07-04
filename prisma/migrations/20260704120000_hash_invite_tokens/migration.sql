-- Invite token hashing (P1 security hardening).
-- Only the SHA-256 hash of an invite token is stored going forward; the raw
-- token lives only in the emailed link. Existing rows keep tokenHash = NULL and
-- are therefore no longer resolvable via the hashed lookup (Strategy A:
-- pre-migration plaintext invites are invalidated — recipients must be re-invited).

-- SchoolInvite
ALTER TABLE "SchoolInvite" ADD COLUMN "tokenHash" TEXT;
CREATE UNIQUE INDEX "SchoolInvite_tokenHash_key" ON "SchoolInvite"("tokenHash");

-- TeacherInvite
ALTER TABLE "TeacherInvite" ADD COLUMN "tokenHash" TEXT;
CREATE UNIQUE INDEX "TeacherInvite_tokenHash_key" ON "TeacherInvite"("tokenHash");
