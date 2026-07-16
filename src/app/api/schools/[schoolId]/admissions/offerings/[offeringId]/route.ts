import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionConfigWrite } from "@/lib/admissions/authorization";
import { admissionOfferingUpdateSchema } from "@/lib/admissions/validation";
import { serializeOffering } from "@/lib/admissions/serializers";

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; offeringId: string }> }) {
  const { schoolId, offeringId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionConfigWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  try {
    const data = admissionOfferingUpdateSchema.parse(await req.json());
    const existing = await prisma.admissionOffering.findFirst({ where: { id: offeringId, admissionCycle: { schoolId } } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const offering = await prisma.admissionOffering.update({
      where: { id: offeringId },
      data: { capacity: data.capacity, applicationsOpen: data.applicationsOpen },
      include: { class: true },
    });
    await logAudit({
      action: "ADMISSION_OFFERING_UPDATED",
      entityType: "AdmissionOffering",
      entityId: offeringId,
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeOffering(offering));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
