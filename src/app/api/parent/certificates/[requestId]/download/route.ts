import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.guardian.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const issued = await prisma.issuedCertificate.findFirst({
    where: { requestId, schoolId: auth.guardian.schoolId },
    select: { fileId: true, studentId: true },
  });
  if (!issued) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, issued.studentId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.redirect(new URL(`/api/files/${issued.fileId}`, req.url));
}
