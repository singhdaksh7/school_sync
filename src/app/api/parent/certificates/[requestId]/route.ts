import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { serializeRequestForRequester } from "@/lib/certificates/serializers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.guardian.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const request = await prisma.certificateRequest.findFirst({
    where: { id: requestId, schoolId: auth.guardian.schoolId },
    include: { issuedCertificate: { select: { id: true, certificateNumber: true } } },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, request.studentId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: serializeRequestForRequester(request) });
}
