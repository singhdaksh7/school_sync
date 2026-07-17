import { NextRequest, NextResponse } from "next/server";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { studentCertificateRequestCreateSchema } from "@/lib/certificates/validation";
import { createCertificateRequest } from "@/lib/certificates/actions";
import { serializeRequestForRequester } from "@/lib/certificates/serializers";
import { prisma } from "@/lib/prisma";

/** Student self-service: request a certificate for themselves (spec rule 1). */
export async function GET(req: NextRequest) {
  const student = await getStudentAuth(req);
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(student.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const requests = await prisma.certificateRequest.findMany({
    where: { schoolId: student.schoolId, studentId: student.studentId },
    include: { issuedCertificate: { select: { id: true, certificateNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ data: requests.map(serializeRequestForRequester) });
}

export async function POST(req: NextRequest) {
  const student = await getStudentAuth(req);
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(student.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = studentCertificateRequestCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const result = await createCertificateRequest({
    schoolId: student.schoolId,
    studentId: student.studentId,
    certificateType: parsed.data.certificateType,
    customLabel: parsed.data.customLabel ?? null,
    purpose: parsed.data.purpose,
    requester: { type: "STUDENT" },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Not routed through logAudit: AuditLog.userId is a required FK to User,
  // and students authenticate via the separate Student/session identity
  // (no User row) — same reason no other student/parent route in this repo
  // calls logAudit. The request row itself (createdAt/status/cancelledAt/
  // reviewedAt/issuedAt) is the immutable history for self-service actions;
  // every STAFF-side transition (review/approve/reject/issue/revoke) IS
  // fully audited via logAudit with a real User id.
  return NextResponse.json({ data: serializeRequestForRequester(result.request) }, { status: 201 });
}
