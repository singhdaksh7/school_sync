import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionConfigWrite, requireAdmissionRead } from "@/lib/admissions/authorization";
import { admissionCycleUpdateSchema } from "@/lib/admissions/validation";
import { serializeCycle } from "@/lib/admissions/serializers";

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

  const cycle = await prisma.admissionCycle.findFirst({ where: { id: cycleId, schoolId } });
  if (!cycle) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(serializeCycle(cycle));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; cycleId: string }> }) {
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
    const data = admissionCycleUpdateSchema.parse(await req.json());
    const existing = await prisma.admissionCycle.findFirst({ where: { id: cycleId, schoolId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const cycle = await prisma.admissionCycle.update({
      where: { id: cycleId },
      data: {
        name: data.name,
        applicationStartAt: data.applicationStartAt ? new Date(data.applicationStartAt) : undefined,
        applicationEndAt: data.applicationEndAt ? new Date(data.applicationEndAt) : undefined,
      },
    });
    await logAudit({
      action: "ADMISSION_CYCLE_UPDATED",
      entityType: "AdmissionCycle",
      entityId: cycle.id,
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeCycle(cycle));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
