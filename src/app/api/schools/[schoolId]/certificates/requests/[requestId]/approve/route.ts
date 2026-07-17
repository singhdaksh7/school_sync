import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction, assertNoSelfReviewConflict } from "@/lib/certificates/authorization";
import { certificateApproveSchema } from "@/lib/certificates/validation";
import { approveCertificateRequest } from "@/lib/certificates/actions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ schoolId: string; requestId: string }> }) {
  const { schoolId, requestId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "APPROVE");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const existing = await prisma.certificateRequest.findFirst({ where: { id: requestId, schoolId }, select: { requesterType: true, requesterUserId: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const conflict = assertNoSelfReviewConflict(access.actor, existing);
  if (conflict) return conflict;

  const body = await req.json().catch(() => null);
  const parsed = certificateApproveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const result = await approveCertificateRequest({
    schoolId,
    requestId,
    expectedVersion: parsed.data.version,
    reviewerId: session.user.id,
    note: parsed.data.note ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    action: "CERTIFICATE_REQUEST_APPROVED",
    entityType: "CertificateRequest",
    entityId: requestId,
    userId: session.user.id,
    schoolId,
    actorRole: access.actor.role,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ data: { id: result.request.id, status: result.request.status, version: result.request.version } });
}
