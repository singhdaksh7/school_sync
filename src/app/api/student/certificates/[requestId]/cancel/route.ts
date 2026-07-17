import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { certificateCancelSchema } from "@/lib/certificates/validation";
import { cancelCertificateRequest } from "@/lib/certificates/actions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const student = await getStudentAuth(req);
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(student.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const owns = await prisma.certificateRequest.findFirst({
    where: { id: requestId, schoolId: student.schoolId, studentId: student.studentId },
    select: { id: true },
  });
  if (!owns) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = certificateCancelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const result = await cancelCertificateRequest({
    schoolId: student.schoolId,
    requestId,
    expectedVersion: parsed.data.version,
    actor: { kind: "REQUESTER", userId: student.studentId },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ data: { id: result.request.id, status: result.request.status, version: result.request.version } });
}
