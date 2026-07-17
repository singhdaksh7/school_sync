import type { Prisma } from "@/generated/prisma/client";
import type { CertificateTypeValue } from "@/lib/certificates/constants";

const TYPE_PREFIX: Record<CertificateTypeValue, string> = {
  BONAFIDE: "BON",
  TRANSFER_CERTIFICATE: "TC",
  CHARACTER_CERTIFICATE: "CC",
  STUDY_CERTIFICATE: "SC",
  CUSTOM: "DOC",
};

/**
 * Atomically allocates the next certificate number for
 * (schoolId, certificateType, sessionLabel) using the same
 * INSERT...ON CONFLICT DO UPDATE...RETURNING pattern as
 * src/lib/admissions/application-number.ts's nextApplicationNumber — never
 * SELECT-then-write count()+1, which races under concurrent issuance.
 *
 * MUST be called inside the same transaction as the IssuedCertificate
 * create (see src/lib/certificates/issue.ts) so a failed issuance never
 * leaves a counter value "burned" out of sync with an actually-created row
 * — though, as with admissions, an occasional gap from a mid-transaction
 * failure is tolerated (never reused) rather than requiring a fully gapless
 * sequence.
 *
 * sessionLabel defaults to "" (not session-scoped) — v1 has no
 * AcademicSession/AcademicYear model (see the admissions module's identical
 * documented deviation), so certificate numbering is school+type scoped only
 * unless a caller explicitly passes a session label.
 */
export async function nextCertificateNumber(
  tx: Prisma.TransactionClient,
  schoolId: string,
  certificateType: CertificateTypeValue,
  sessionLabel = ""
): Promise<string> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "CertificateCounter" ("schoolId", "certificateType", "sessionLabel", "lastValue", "updatedAt")
    VALUES (${schoolId}, ${certificateType}::"CertificateType", ${sessionLabel}, 1, now())
    ON CONFLICT ("schoolId", "certificateType", "sessionLabel")
    DO UPDATE SET "lastValue" = "CertificateCounter"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"
  `;
  const seq = rows[0]?.lastValue;
  if (seq === undefined) throw new Error("Failed to allocate certificate number");

  const year = new Date().getFullYear();
  const prefix = TYPE_PREFIX[certificateType];
  return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
}
