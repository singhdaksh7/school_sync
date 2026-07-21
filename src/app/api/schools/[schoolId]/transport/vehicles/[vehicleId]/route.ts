import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { logAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; vehicleId: string }> }) {
  const { schoolId, vehicleId } = await params;
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

  const existing = await prisma.vehicle.findFirst({ where: { id: vehicleId, schoolId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const body = await req.json();
  const data: { registrationNumber?: string; capacity?: number | null; model?: string | null; isActive?: boolean } = {};

  if (body.registrationNumber !== undefined) {
    const registrationNumber = typeof body.registrationNumber === "string" ? body.registrationNumber.trim() : "";
    if (!registrationNumber) return NextResponse.json({ error: "Registration number is required" }, { status: 400 });
    data.registrationNumber = registrationNumber;
  }
  if (body.capacity !== undefined) {
    data.capacity = typeof body.capacity === "number" && Number.isInteger(body.capacity) ? body.capacity : null;
  }
  if (body.model !== undefined) {
    data.model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  }
  if (body.isActive !== undefined) {
    data.isActive = Boolean(body.isActive);
  }

  try {
    const vehicle = await prisma.vehicle.update({ where: { id: vehicleId }, data });

    await logAudit({
      action: "TRANSPORT_VEHICLE_UPDATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      userId: session.user.id,
      schoolId,
      actorRole: sessionRole(session.user),
    });

    return NextResponse.json(vehicle);
  } catch (err) {
    if (hasPrismaErrorCode(err, "P2002")) {
      return NextResponse.json({ error: "A vehicle with that registration number already exists", code: "DUPLICATE_REGISTRATION" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ schoolId: string; vehicleId: string }> }) {
  const { schoolId, vehicleId } = await params;
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

  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, schoolId }, select: { id: true } });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const assignedRoutes = await prisma.route.count({ where: { schoolId, vehicleId } });
  if (assignedRoutes > 0) {
    return NextResponse.json(
      { error: "Unassign this vehicle from every route before deleting it", code: "VEHICLE_IN_USE" },
      { status: 409 }
    );
  }

  await prisma.vehicle.delete({ where: { id: vehicleId } });

  await logAudit({
    action: "TRANSPORT_VEHICLE_DELETED",
    entityType: "Vehicle",
    entityId: vehicleId,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
  });

  return NextResponse.json({ ok: true });
}
