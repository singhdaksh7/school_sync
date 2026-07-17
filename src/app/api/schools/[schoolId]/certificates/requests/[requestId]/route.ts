import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { serializeRequestForStaff } from "@/lib/certificates/serializers";

const REQUEST_INCLUDE = {
  student: { select: { id: true, name: true, admissionNo: true, rollNo: true } },
  requesterUser: { select: { id: true, name: true } },
  requesterGuardian: { select: { id: true, name: true } },
  reviewer: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
  issuedCertificate: { select: { id: true, certificateNumber: true } },
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ schoolId: string; requestId: string }> }) {
  const { schoolId, requestId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "REQUEST_VIEW");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const request = await prisma.certificateRequest.findFirst({ where: { id: requestId, schoolId }, include: REQUEST_INCLUDE });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: serializeRequestForStaff(request) });
}
