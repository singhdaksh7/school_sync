import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionConfigWrite, requireAdmissionRead } from "@/lib/admissions/authorization";
import { admissionApplicationUpdateSchema, normalizeOptionalString } from "@/lib/admissions/validation";
import { serializeApplicationDetail } from "@/lib/admissions/serializers";
import { isTerminalStatus } from "@/lib/admissions/transitions";
import type { AdmissionApplicationStatusValue } from "@/lib/admissions/constants";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionRead(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId } });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(serializeApplicationDetail(application));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionConfigWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    for (const forbiddenKey of ["schoolId", "createdById", "decidedById", "enrolledStudentId", "status", "applicationNumber", "actorId"]) {
      delete (body as Record<string, unknown>)[forbiddenKey];
    }
    const data = admissionApplicationUpdateSchema.parse(body);

    const existing = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (isTerminalStatus(existing.status as AdmissionApplicationStatusValue)) {
      return NextResponse.json({ error: `Application is ${existing.status} and can no longer be edited` }, { status: 400 });
    }

    const application = await prisma.admissionApplication.update({
      where: { id: applicationId },
      data: {
        applicantFirstName: data.applicantFirstName,
        applicantMiddleName: data.applicantMiddleName !== undefined ? normalizeOptionalString(data.applicantMiddleName) : undefined,
        applicantLastName: data.applicantLastName,
        applicantDob: data.applicantDob ? new Date(data.applicantDob) : undefined,
        applicantGender: data.applicantGender !== undefined ? normalizeOptionalString(data.applicantGender) : undefined,
        currentSchoolName: data.currentSchoolName !== undefined ? normalizeOptionalString(data.currentSchoolName) : undefined,
        previousSchoolName: data.previousSchoolName !== undefined ? normalizeOptionalString(data.previousSchoolName) : undefined,
        guardianName: data.guardianName,
        guardianRelation: data.guardianRelation,
        guardianPhone: data.guardianPhone,
        guardianEmail: data.guardianEmail !== undefined ? normalizeOptionalString(data.guardianEmail) : undefined,
        addressLine1: data.addressLine1 !== undefined ? normalizeOptionalString(data.addressLine1) : undefined,
        addressLine2: data.addressLine2 !== undefined ? normalizeOptionalString(data.addressLine2) : undefined,
        addressCity: data.addressCity !== undefined ? normalizeOptionalString(data.addressCity) : undefined,
        addressState: data.addressState !== undefined ? normalizeOptionalString(data.addressState) : undefined,
        addressPostalCode: data.addressPostalCode !== undefined ? normalizeOptionalString(data.addressPostalCode) : undefined,
        source: data.source !== undefined ? normalizeOptionalString(data.source) : undefined,
        version: { increment: 1 },
      },
    });

    await logAudit({
      action: "ADMISSION_APPLICATION_UPDATED",
      entityType: "AdmissionApplication",
      entityId: applicationId,
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeApplicationDetail(application));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
