import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole, hasPrismaErrorCode, classBelongsToSchool } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionConfigWrite, requireAdmissionRead } from "@/lib/admissions/authorization";
import { admissionOfferingCreateSchema } from "@/lib/admissions/validation";
import { serializeOffering } from "@/lib/admissions/serializers";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; cycleId: string }> }) {
  const { schoolId, cycleId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionRead(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  const cycle = await prisma.admissionCycle.findFirst({ where: { id: cycleId, schoolId }, select: { id: true } });
  if (!cycle) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const offerings = await prisma.admissionOffering.findMany({
    where: { admissionCycleId: cycleId },
    include: { class: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(offerings.map(serializeOffering));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; cycleId: string }> }) {
  const { schoolId, cycleId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionConfigWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  try {
    const data = admissionOfferingCreateSchema.parse(await req.json());
    const cycle = await prisma.admissionCycle.findFirst({ where: { id: cycleId, schoolId }, select: { id: true } });
    if (!cycle) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await classBelongsToSchool(data.classId, schoolId))) {
      return NextResponse.json({ error: "Class not found in this school" }, { status: 400 });
    }

    const offering = await prisma.admissionOffering.create({
      data: { admissionCycleId: cycleId, classId: data.classId, capacity: data.capacity, applicationsOpen: data.applicationsOpen },
      include: { class: true },
    });
    await logAudit({
      action: "ADMISSION_OFFERING_CREATED",
      entityType: "AdmissionOffering",
      entityId: offering.id,
      metadata: { classId: data.classId, capacity: data.capacity },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeOffering(offering), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: "This class already has an offering in this cycle" }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
