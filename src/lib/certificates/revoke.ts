import { prisma } from "@/lib/prisma";

export type RevokeResult = { ok: true; alreadyRevoked: boolean } | { ok: false; status: number; error: string };

/**
 * Revokes an issued certificate. Idempotent: revoking an already-revoked
 * certificate is a no-op success (spec rule 10 / §12 "idempotent revoke
 * behaviour") rather than an error — the second caller sees the same
 * revokedAt/reason as the first. The IssuedCertificate row itself is never
 * mutated for anything other than the revocation fields; snapshotData,
 * fileId, certificateNumber etc. stay exactly as issued.
 */
export async function revokeCertificate(params: {
  schoolId: string;
  issuedCertificateId: string;
  revokedById: string;
  reason: string;
}): Promise<RevokeResult> {
  const existing = await prisma.issuedCertificate.findFirst({
    where: { id: params.issuedCertificateId, schoolId: params.schoolId },
  });
  if (!existing) return { ok: false, status: 404, error: "Not found" };
  if (existing.revokedAt) return { ok: true, alreadyRevoked: true };

  await prisma.$transaction([
    prisma.issuedCertificate.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedById: params.revokedById, revokeReason: params.reason },
    }),
    prisma.certificateRequest.update({
      where: { id: existing.requestId },
      data: { status: "REVOKED", version: { increment: 1 } },
    }),
  ]);

  return { ok: true, alreadyRevoked: false };
}
