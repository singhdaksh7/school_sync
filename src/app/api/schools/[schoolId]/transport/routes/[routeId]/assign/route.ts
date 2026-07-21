import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, driverBelongsToSchool, sessionRole, vehicleBelongsToSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { logAudit } from "@/lib/audit";

// vehicleId/driverId: string to assign, null to explicitly unassign, or
// omitted to leave that side untouched.
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; routeId: string }> }) {
  const { schoolId, routeId } = await params;
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

  const route = await prisma.route.findFirst({ where: { id: routeId, schoolId }, select: { id: true } });
  if (!route) return NextResponse.json({ error: "Route not found" }, { status: 404 });

  const body = await req.json();
  const data: { vehicleId?: string | null; driverId?: string | null } = {};

  if (body.vehicleId !== undefined) {
    if (body.vehicleId !== null) {
      if (typeof body.vehicleId !== "string" || !(await vehicleBelongsToSchool(body.vehicleId, schoolId))) {
        return NextResponse.json({ error: "Vehicle not found in this school" }, { status: 400 });
      }
    }
    data.vehicleId = body.vehicleId;
  }
  if (body.driverId !== undefined) {
    if (body.driverId !== null) {
      if (typeof body.driverId !== "string" || !(await driverBelongsToSchool(body.driverId, schoolId))) {
        return NextResponse.json({ error: "Driver not found in this school" }, { status: 400 });
      }
    }
    data.driverId = body.driverId;
  }

  const updated = await prisma.route.update({
    where: { id: routeId },
    data,
    include: {
      vehicle: { select: { id: true, registrationNumber: true } },
      driver: { select: { id: true, name: true, phone: true } },
    },
  });

  await logAudit({
    action: "TRANSPORT_ROUTE_ASSIGNMENT_CHANGED",
    entityType: "Route",
    entityId: routeId,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
    metadata: { vehicleId: updated.vehicleId, driverId: updated.driverId },
  });

  return NextResponse.json(updated);
}
