import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { certificateRevokeSchema } from "@/lib/certificates/validation";
import { revokeCertificate } from "@/lib/certificates/revoke";
import { emitCertificateEvent } from "@/lib/certificates/events";

/** Revocation requires permission + a mandatory reason (spec §4 rule 8); idempotent on repeat calls. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ schoolId: string; issuedId: string }> }) {
  const { schoolId, issuedId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "REVOKE");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = certificateRevokeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const result = await revokeCertificate({ schoolId, issuedCertificateId: issuedId, revokedById: session.user.id, reason: parsed.data.reason });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (!result.alreadyRevoked) {
    const issued = await prisma.issuedCertificate.findUnique({ where: { id: issuedId }, select: { studentId: true } });
    await logAudit({
      action: "CERTIFICATE_REVOKED",
      entityType: "IssuedCertificate",
      entityId: issuedId,
      metadata: { reason: parsed.data.reason },
      userId: session.user.id,
      schoolId,
      actorRole: access.actor.role,
      ipAddress: getClientIp(req),
    });
    if (issued) emitCertificateEvent({ type: "CERTIFICATE_REVOKED", schoolId, issuedCertificateId: issuedId, studentId: issued.studentId });
  }

  return NextResponse.json({ data: { id: issuedId, revoked: true } });
}
