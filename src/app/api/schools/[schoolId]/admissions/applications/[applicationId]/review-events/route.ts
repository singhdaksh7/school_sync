import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole, teacherBelongsToSchool } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionRead, requireAdmissionReviewWrite } from "@/lib/admissions/authorization";
import { admissionReviewEventCreateSchema, normalizeOptionalString } from "@/lib/admissions/validation";
import { serializeReviewEvent } from "@/lib/admissions/serializers";

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

  const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId }, select: { id: true } });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const events = await prisma.admissionReviewEvent.findMany({ where: { applicationId }, orderBy: { scheduledAt: "asc" } });
  return NextResponse.json(events.map((e) => serializeReviewEvent(e, { includeInternal: true })));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionReviewWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  try {
    const data = admissionReviewEventCreateSchema.parse(await req.json());
    const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId }, select: { id: true } });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (data.evaluatorTeacherId && !(await teacherBelongsToSchool(data.evaluatorTeacherId, schoolId))) {
      return NextResponse.json({ error: "Evaluator teacher not found in this school" }, { status: 400 });
    }

    const event = await prisma.admissionReviewEvent.create({
      data: {
        applicationId,
        schoolId,
        type: data.type,
        scheduledAt: new Date(data.scheduledAt),
        evaluatorTeacherId: data.evaluatorTeacherId ?? null,
        location: normalizeOptionalString(data.location),
        instructions: normalizeOptionalString(data.instructions),
        createdById: access.actor.userId,
      },
    });

    await logAudit({
      action: "ADMISSION_REVIEW_EVENT_CREATED",
      entityType: "AdmissionReviewEvent",
      entityId: event.id,
      metadata: { applicationId, type: data.type },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeReviewEvent(event, { includeInternal: true }), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
