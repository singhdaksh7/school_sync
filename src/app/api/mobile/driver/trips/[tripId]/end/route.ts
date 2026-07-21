import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedDriver } from "@/lib/driver-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { systemClock } from "@/lib/clock";

// See src/app/api/mobile/driver/trips/start/route.ts for why this handler
// does not call logAudit() despite TRANSPORT_TRIP_ENDED existing in
// AuditAction — same AuditLog.userId FK gap, documented there.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const authed = await getAuthenticatedDriver(req);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(authed.driver.schoolId, "TRANSPORT");
  if (featureDenied) return featureDenied;

  const rateLimited = await enforceActorRateLimit({ schoolId: authed.driver.schoolId, actorType: "DRIVER", actorId: authed.driver.id }, "MUTATION");
  if (rateLimited) return rateLimited;

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, schoolId: authed.driver.schoolId },
    select: { id: true, driverId: true, status: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Only the assigned driver may act on their own trip.
  if (trip.driverId !== authed.driver.id) {
    return NextResponse.json({ error: "You are not assigned to this trip" }, { status: 403 });
  }

  if (trip.status !== "ACTIVE") {
    // Double-end (or ending a trip that was never started / already
    // completed/cancelled) is rejected cleanly, not a crash or silent no-op.
    return NextResponse.json({ error: "Trip is not active", code: "TRIP_NOT_ACTIVE" }, { status: 409 });
  }

  const now = systemClock.now();
  const updated = await prisma.trip.updateMany({
    where: { id: trip.id, status: "ACTIVE" },
    data: { status: "COMPLETED", endedAt: now },
  });
  if (updated.count === 0) {
    // Raced with a concurrent end request — same clean rejection, no crash.
    return NextResponse.json({ error: "Trip is not active", code: "TRIP_NOT_ACTIVE" }, { status: 409 });
  }

  const result = await prisma.trip.findUnique({ where: { id: trip.id } });
  return NextResponse.json({ trip: result });
}
