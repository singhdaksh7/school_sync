import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { serializeRequestForRequester } from "@/lib/certificates/serializers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const student = await getStudentAuth(req);
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(student.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const request = await prisma.certificateRequest.findFirst({
    where: { id: requestId, schoolId: student.schoolId, studentId: student.studentId },
    include: { issuedCertificate: { select: { id: true, certificateNumber: true } } },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: serializeRequestForRequester(request) });
}
