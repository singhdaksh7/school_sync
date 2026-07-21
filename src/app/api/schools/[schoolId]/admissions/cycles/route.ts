import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole, hasPrismaErrorCode } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionConfigWrite, requireAdmissionRead } from "@/lib/admissions/authorization";
import { admissionCycleCreateSchema } from "@/lib/admissions/validation";
import { serializeCycle } from "@/lib/admissions/serializers";
import { parsePagination, paginated } from "@/lib/pagination";

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
  const [rows, total] = await Promise.all([
    prisma.admissionCycle.findMany({ where: { schoolId }, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.admissionCycle.count({ where: { schoolId } }),
  ]);
  return NextResponse.json(paginated(rows.map(serializeCycle), total, { skip, take, page, limit }));
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

  try {
    const data = admissionCycleCreateSchema.parse(await req.json());
    const cycle = await prisma.admissionCycle.create({
      data: {
        schoolId,
        sessionLabel: data.sessionLabel,
        name: data.name,
        applicationStartAt: new Date(data.applicationStartAt),
        applicationEndAt: new Date(data.applicationEndAt),
        createdById: access.actor.userId,
      },
    });
    await logAudit({
      action: "ADMISSION_CYCLE_CREATED",
      entityType: "AdmissionCycle",
      entityId: cycle.id,
      metadata: { sessionLabel: cycle.sessionLabel },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeCycle(cycle), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: "A conflicting admission cycle already exists" }, { status: 400 });
    console.error("Create admission cycle error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
