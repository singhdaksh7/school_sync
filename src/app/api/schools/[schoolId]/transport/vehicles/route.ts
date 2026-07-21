import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { logAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "TRANSPORT");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { schoolId },
    include: { _count: { select: { routes: true } } },
    orderBy: { registrationNumber: "asc" },
  });

  return NextResponse.json(vehicles);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "TRANSPORT");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  const body = await req.json();
  const registrationNumber = typeof body.registrationNumber === "string" ? body.registrationNumber.trim() : "";
  if (!registrationNumber) return NextResponse.json({ error: "Registration number is required" }, { status: 400 });
  const capacity = typeof body.capacity === "number" && Number.isInteger(body.capacity) ? body.capacity : null;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;

  try {
    const vehicle = await prisma.vehicle.create({
      data: { schoolId, registrationNumber, capacity, model },
    });

    await logAudit({
      action: "TRANSPORT_VEHICLE_CREATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      userId: session.user.id,
      schoolId,
      actorRole: sessionRole(session.user),
      metadata: { registrationNumber: vehicle.registrationNumber },
    });

    return NextResponse.json(vehicle, { status: 201 });
  } catch (err) {
    if (hasPrismaErrorCode(err, "P2002")) {
      return NextResponse.json({ error: "A vehicle with that registration number already exists", code: "DUPLICATE_REGISTRATION" }, { status: 409 });
    }
    throw err;
  }
}
