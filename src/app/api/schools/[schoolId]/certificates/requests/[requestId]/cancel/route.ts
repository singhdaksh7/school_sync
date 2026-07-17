import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { certificateCancelSchema } from "@/lib/certificates/validation";
import { cancelCertificateRequest } from "@/lib/certificates/actions";

/** Staff-initiated cancellation (broader status window than a requester's self-cancel — see constants.ts). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ schoolId: string; requestId: string }> }) {
  const { schoolId, requestId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "REVIEW");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = certificateCancelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const result = await cancelCertificateRequest({
    schoolId,
    requestId,
    expectedVersion: parsed.data.version,
    actor: { kind: "STAFF", userId: session.user.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    action: "CERTIFICATE_REQUEST_CANCELLED",
    entityType: "CertificateRequest",
    entityId: requestId,
    userId: session.user.id,
    schoolId,
    actorRole: access.actor.role,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ data: { id: result.request.id, status: result.request.status, version: result.request.version } });
}
