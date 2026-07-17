import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";

/**
 * Redirects to the authorized file-serving route (/api/files/[fileId]),
 * which performs its own independent ownership check — this route never
 * returns bytes or a raw storage key itself, only the StoredFile row id.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const student = await getStudentAuth(req);
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(student.schoolId, "CERTIFICATES");
  if (denied) return denied;

  const issued = await prisma.issuedCertificate.findFirst({
    where: { requestId, schoolId: student.schoolId, studentId: student.studentId },
    select: { fileId: true },
  });
  if (!issued) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.redirect(new URL(`/api/files/${issued.fileId}`, req.url));
}
