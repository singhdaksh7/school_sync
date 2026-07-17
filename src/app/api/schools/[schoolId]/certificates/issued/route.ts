import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { issuedCertificateListQuerySchema } from "@/lib/certificates/validation";
import { serializeIssuedCertificate } from "@/lib/certificates/serializers";
import { decodeCursor, cursorWhereBefore, clampLimit, buildCursorPage } from "@/lib/certificates/pagination";

/** Issued/revoked certificate register — search by certificate number, student name, or admission number (spec §11). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "REQUEST_VIEW");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const query = issuedCertificateListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Invalid query", details: query.error.flatten() }, { status: 400 });
  const { certificateType, status, certificateNumber, studentName, admissionNo, cursor, limit } = query.data;

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const take = clampLimit(limit);

  const rows = await prisma.issuedCertificate.findMany({
    where: {
      schoolId,
      ...(certificateType ? { certificateType } : {}),
      ...(status === "VALID" ? { revokedAt: null } : status === "REVOKED" ? { revokedAt: { not: null } } : {}),
      ...(certificateNumber ? { certificateNumber: { contains: certificateNumber, mode: "insensitive" as const } } : {}),
      ...(studentName ? { student: { name: { contains: studentName, mode: "insensitive" as const } } } : {}),
      ...(admissionNo ? { student: { admissionNo: { contains: admissionNo, mode: "insensitive" as const } } } : {}),
      ...cursorWhereBefore(decoded),
    },
    include: { student: { select: { id: true, name: true, admissionNo: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const { page, nextCursor } = buildCursorPage(rows, take);
  return NextResponse.json({ data: page.map(serializeIssuedCertificate), nextCursor });
}
