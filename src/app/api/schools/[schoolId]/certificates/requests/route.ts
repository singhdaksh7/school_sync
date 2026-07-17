import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { certificateRequestCreateSchema, certificateListQuerySchema } from "@/lib/certificates/validation";
import { createCertificateRequest } from "@/lib/certificates/actions";
import { serializeRequestForStaff } from "@/lib/certificates/serializers";
import { decodeCursor, cursorWhereBefore, clampLimit, buildCursorPage } from "@/lib/certificates/pagination";

const REQUEST_INCLUDE = {
  student: { select: { id: true, name: true, admissionNo: true, rollNo: true } },
  requesterUser: { select: { id: true, name: true } },
  requesterGuardian: { select: { id: true, name: true } },
  reviewer: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
  issuedCertificate: { select: { id: true, certificateNumber: true } },
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "REQUEST_VIEW");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const query = certificateListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Invalid query", details: query.error.flatten() }, { status: 400 });
  const { status, certificateType, studentId, q, cursor, limit } = query.data;

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const take = clampLimit(limit);

  const rows = await prisma.certificateRequest.findMany({
    where: {
      schoolId,
      ...(status ? { status } : {}),
      ...(certificateType ? { certificateType } : {}),
      ...(studentId ? { studentId } : {}),
      ...(q
        ? {
            OR: [
              { student: { name: { contains: q, mode: "insensitive" as const } } },
              { student: { admissionNo: { contains: q, mode: "insensitive" as const } } },
              { purpose: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...cursorWhereBefore(decoded),
    },
    include: REQUEST_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const { page, nextCursor } = buildCursorPage(rows, take);
  return NextResponse.json({ data: page.map(serializeRequestForStaff), nextCursor });
}

/** Staff creating a request on behalf of a student (spec rule 3). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "REQUEST_VIEW");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = certificateRequestCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const student = await prisma.student.findFirst({ where: { id: parsed.data.studentId, schoolId }, select: { id: true } });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await createCertificateRequest({
    schoolId,
    studentId: student.id,
    certificateType: parsed.data.certificateType,
    customLabel: parsed.data.customLabel ?? null,
    purpose: parsed.data.purpose,
    requester: { type: "STAFF", userId: session.user.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    action: "CERTIFICATE_REQUEST_CREATED",
    entityType: "CertificateRequest",
    entityId: result.request.id,
    metadata: { studentId: student.id, certificateType: result.request.certificateType, requesterType: "STAFF" },
    userId: session.user.id,
    schoolId,
    actorRole: access.actor.role,
    ipAddress: getClientIp(req),
  });

  const full = await prisma.certificateRequest.findUnique({ where: { id: result.request.id }, include: REQUEST_INCLUDE });
  return NextResponse.json({ data: serializeRequestForStaff(full!) }, { status: 201 });
}
