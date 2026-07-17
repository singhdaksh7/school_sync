import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { certificateIssueSchema } from "@/lib/certificates/validation";
import { issueCertificate } from "@/lib/certificates/issue";
import { emitCertificateEvent } from "@/lib/certificates/events";

function publicBaseUrl(req: NextRequest): string {
  return process.env.NEXTAUTH_URL || process.env.AUTH_URL || req.nextUrl.origin;
}

/** Concurrency-safe, idempotent issuance (spec §12) — see src/lib/certificates/issue.ts for the transactional detail. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ schoolId: string; requestId: string }> }) {
  const { schoolId, requestId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "ISSUE");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = certificateIssueSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const result = await issueCertificate({
    schoolId,
    requestId,
    issuedById: session.user.id,
    expectedVersion: parsed.data.version,
    explicitTemplateId: parsed.data.templateId,
    publicBaseUrl: publicBaseUrl(req),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (!result.alreadyIssued) {
    await logAudit({
      action: "CERTIFICATE_ISSUED",
      entityType: "IssuedCertificate",
      entityId: result.issuedCertificateId,
      metadata: { requestId, certificateNumber: result.certificateNumber },
      userId: session.user.id,
      schoolId,
      actorRole: access.actor.role,
      ipAddress: getClientIp(req),
    });
    emitCertificateEvent({ type: "CERTIFICATE_ISSUED", schoolId, requestId, studentId: "", issuedCertificateId: result.issuedCertificateId });
  }

  return NextResponse.json({ data: { issuedCertificateId: result.issuedCertificateId, certificateNumber: result.certificateNumber } });
}
