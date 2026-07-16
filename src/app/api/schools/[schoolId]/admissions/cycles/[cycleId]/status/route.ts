import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole, hasPrismaErrorCode } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionConfigWrite } from "@/lib/admissions/authorization";
import { admissionCycleStatusSchema } from "@/lib/admissions/validation";
import { serializeCycle } from "@/lib/admissions/serializers";

// Cycle lifecycle transitions (distinct, smaller state machine from the
// application lifecycle in src/lib/admissions/constants.ts): DRAFT -> OPEN ->
// CLOSED -> ARCHIVED, with CLOSED -> OPEN allowed as an explicit "reopen".
const CYCLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["OPEN", "ARCHIVED"],
  OPEN: ["CLOSED"],
  CLOSED: ["OPEN", "ARCHIVED"],
  ARCHIVED: [],
};

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
    const { status: nextStatus } = admissionCycleStatusSchema.parse(await req.json());
    const cycle = await prisma.admissionCycle.findFirst({ where: { id: cycleId, schoolId } });
    if (!cycle) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const allowed = CYCLE_TRANSITIONS[cycle.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      return NextResponse.json({ error: `Cannot transition cycle from ${cycle.status} to ${nextStatus}` }, { status: 400 });
    }

    const updated = await prisma.admissionCycle.update({ where: { id: cycleId }, data: { status: nextStatus } });
    await logAudit({
      action: "ADMISSION_CYCLE_STATUS_CHANGED",
      entityType: "AdmissionCycle",
      entityId: cycleId,
      metadata: { from: cycle.status, to: nextStatus },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeCycle(updated));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    // The partial unique index (schoolId, sessionLabel) WHERE status='OPEN'
    // surfaces here as a P2002 if a second OPEN cycle is attempted for the
    // same session.
    if (hasPrismaErrorCode(err, "P2002")) {
      return NextResponse.json({ error: "Another cycle for this session is already OPEN" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
