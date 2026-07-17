import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { certificateRequestCreateSchema } from "@/lib/certificates/validation";
import { createCertificateRequest } from "@/lib/certificates/actions";
import { serializeRequestForRequester } from "@/lib/certificates/serializers";

/** Parent/guardian self-service for a linked child only (spec rule 2). */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.guardian.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const studentId = req.nextUrl.searchParams.get("studentId");
  if (studentId && !(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, studentId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const linkedStudentIds = (
    await prisma.studentGuardian.findMany({
      where: { guardianId: auth.guardian.id, schoolId: auth.guardian.schoolId },
      select: { studentId: true },
    })
  ).map((l) => l.studentId);

  const requests = await prisma.certificateRequest.findMany({
    where: {
      schoolId: auth.guardian.schoolId,
      studentId: studentId ? studentId : { in: linkedStudentIds },
    },
    include: { issuedCertificate: { select: { id: true, certificateNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ data: requests.map(serializeRequestForRequester) });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.guardian.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = certificateRequestCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  // Never trust a client-supplied studentId as authorization — only a
  // student actually linked to this guardian can be targeted. Cross-school
  // / unrelated-child access returns a non-enumerating 404 (spec §9).
  const canAccess = await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, parsed.data.studentId);
  if (!canAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await createCertificateRequest({
    schoolId: auth.guardian.schoolId,
    studentId: parsed.data.studentId,
    certificateType: parsed.data.certificateType,
    customLabel: parsed.data.customLabel ?? null,
    purpose: parsed.data.purpose,
    requester: { type: "GUARDIAN", guardianId: auth.guardian.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // See src/app/api/student/certificates/route.ts for why this is not
  // routed through logAudit (Guardian has no User row either).
  return NextResponse.json({ data: serializeRequestForRequester(result.request) }, { status: 201 });
}
