import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole, hasPrismaErrorCode } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionConfigWrite, requireAdmissionRead } from "@/lib/admissions/authorization";
import { admissionApplicationCreateSchema, normalizeOptionalString } from "@/lib/admissions/validation";
import { serializeApplicationDetail, serializeApplicationListItem } from "@/lib/admissions/serializers";
import { nextApplicationNumber } from "@/lib/admissions/application-number";
import { parsePagination, paginated } from "@/lib/pagination";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionRead(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, limit } = parsePagination(searchParams);

  const cycleId = searchParams.get("cycleId") || undefined;
  const offeringId = searchParams.get("offeringId") || undefined;
  const status = searchParams.get("status") || undefined;
  const applicationNumber = searchParams.get("applicationNumber") || undefined;
  const applicantName = searchParams.get("applicantName") || undefined;
  const guardianPhone = searchParams.get("guardianPhone") || undefined;
  const guardianEmail = searchParams.get("guardianEmail") || undefined;
  const submittedFrom = searchParams.get("submittedFrom") || undefined;
  const submittedTo = searchParams.get("submittedTo") || undefined;

  const where = {
    schoolId,
    ...(cycleId ? { admissionCycleId: cycleId } : {}),
    ...(offeringId ? { admissionOfferingId: offeringId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(applicationNumber ? { applicationNumber: { contains: applicationNumber, mode: "insensitive" as const } } : {}),
    ...(guardianPhone ? { guardianPhone: { contains: guardianPhone } } : {}),
    ...(guardianEmail ? { guardianEmail: { contains: guardianEmail, mode: "insensitive" as const } } : {}),
    ...(applicantName
      ? {
          OR: [
            { applicantFirstName: { contains: applicantName, mode: "insensitive" as const } },
            { applicantLastName: { contains: applicantName, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(submittedFrom || submittedTo
      ? { submittedAt: { ...(submittedFrom ? { gte: new Date(submittedFrom) } : {}), ...(submittedTo ? { lte: new Date(submittedTo) } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.admissionApplication.findMany({
      where,
      include: { admissionOffering: { include: { class: true } } },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.admissionApplication.count({ where }),
  ]);

  return NextResponse.json(paginated(rows.map(serializeApplicationListItem), total, { skip, take, page, limit }));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionConfigWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }
  {
    const limited = await rateLimit(`admissions:create:${schoolId}:${access.actor.userId}`, RATE_LIMIT_POLICIES.payment);
    if (!limited.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
    }
  }

  try {
    const body = await req.json();
    // Explicitly strip any client-supplied identity/audit fields before
    // parsing — .strict() below also rejects them outright, this is a
    // defense-in-depth belt-and-suspenders removal so a permissive future
    // schema change can't accidentally start trusting them.
    for (const forbiddenKey of ["schoolId", "createdById", "decidedById", "enrolledStudentId", "status", "applicationNumber", "actorId", "version"]) {
      delete (body as Record<string, unknown>)[forbiddenKey];
    }
    const data = admissionApplicationCreateSchema.parse(body);

    const offering = await prisma.admissionOffering.findFirst({
      where: { id: data.admissionOfferingId, admissionCycleId: data.admissionCycleId, admissionCycle: { schoolId } },
      select: { id: true },
    });
    if (!offering) return NextResponse.json({ error: "Offering does not belong to the given cycle in this school" }, { status: 400 });

    const application = await prisma.$transaction(async (tx) => {
      const applicationNumber = await nextApplicationNumber(tx, schoolId);
      return tx.admissionApplication.create({
        data: {
          schoolId,
          admissionCycleId: data.admissionCycleId,
          admissionOfferingId: data.admissionOfferingId,
          applicationNumber,
          applicantFirstName: data.applicantFirstName,
          applicantMiddleName: normalizeOptionalString(data.applicantMiddleName),
          applicantLastName: data.applicantLastName,
          applicantDob: new Date(data.applicantDob),
          applicantGender: normalizeOptionalString(data.applicantGender),
          currentSchoolName: normalizeOptionalString(data.currentSchoolName),
          previousSchoolName: normalizeOptionalString(data.previousSchoolName),
          guardianName: data.guardianName,
          guardianRelation: data.guardianRelation,
          guardianPhone: data.guardianPhone,
          guardianEmail: normalizeOptionalString(data.guardianEmail),
          addressLine1: normalizeOptionalString(data.addressLine1),
          addressLine2: normalizeOptionalString(data.addressLine2),
          addressCity: normalizeOptionalString(data.addressCity),
          addressState: normalizeOptionalString(data.addressState),
          addressPostalCode: normalizeOptionalString(data.addressPostalCode),
          source: normalizeOptionalString(data.source),
          createdById: access.actor.userId,
        },
      });
    });

    await logAudit({
      action: "ADMISSION_APPLICATION_CREATED",
      entityType: "AdmissionApplication",
      entityId: application.id,
      metadata: { applicationNumber: application.applicationNumber },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeApplicationDetail(application), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: "A conflicting application already exists" }, { status: 400 });
    console.error("Create admission application error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
