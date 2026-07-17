import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { certificateCancelSchema } from "@/lib/certificates/validation";
import { cancelCertificateRequest } from "@/lib/certificates/actions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.guardian.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const existing = await prisma.certificateRequest.findFirst({ where: { id: requestId, schoolId: auth.guardian.schoolId }, select: { studentId: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, existing.studentId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = certificateCancelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const result = await cancelCertificateRequest({
    schoolId: auth.guardian.schoolId,
    requestId,
    expectedVersion: parsed.data.version,
    actor: { kind: "REQUESTER", userId: auth.guardian.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ data: { id: result.request.id, status: result.request.status, version: result.request.version } });
}
