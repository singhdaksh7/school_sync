import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedDriver } from "@/lib/driver-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { systemClock } from "@/lib/clock";

class TripAlreadyActiveError extends Error {}

/**
 * Starts a trip on one of the driver's own assigned routes.
 *
 * NOTE on audit logging: TRANSPORT_TRIP_STARTED/ENDED were added to
 * AuditAction (src/lib/audit.ts) as requested, but this handler deliberately
 * does NOT call logAudit() for the driver actor. AuditLog.userId is a
 * required, non-nullable foreign key to User — Driver is not a User (same
 * precedent as Guardian), so there is no legitimate id to pass. Calling
 * logAudit with driver.id would fail the FK constraint on every call
 * (silently swallowed by logAudit's try/catch, since it errors-only-logs),
 * i.e. it would look like it worked but would never actually persist a row.
 * Making this real requires a migration (nullable userId and/or a driverId
 * column on AuditLog) — out of scope for this "zero new migrations" phase.
 * See the final report for the same gap and the SessionActorType/AuthSession
 * one in src/lib/driver-auth.ts.
 */
export async function POST(req: NextRequest) {
  const authed = await getAuthenticatedDriver(req);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(authed.driver.schoolId, "TRANSPORT");
  if (featureDenied) return featureDenied;

  const rateLimited = await enforceActorRateLimit({ schoolId: authed.driver.schoolId, actorType: "DRIVER", actorId: authed.driver.id }, "MUTATION");
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const routeId = typeof (body as { routeId?: unknown })?.routeId === "string" ? (body as { routeId: string }).routeId : "";
  if (!routeId) return NextResponse.json({ error: "routeId is required" }, { status: 400 });

  // Only a route this driver is actually assigned to, in their own school.
  const route = await prisma.route.findFirst({
    where: { id: routeId, schoolId: authed.driver.schoolId, driverId: authed.driver.id },
    select: { id: true, vehicleId: true, isActive: true },
  });
  if (!route) return NextResponse.json({ error: "Route not found" }, { status: 404 });
  if (!route.vehicleId) return NextResponse.json({ error: "This route has no vehicle assigned" }, { status: 400 });

  const now = systemClock.now();

  try {
    const trip = await prisma.$transaction(async (tx) => {
      // No two ACTIVE trips per route, simultaneously — including a double
      // start by this same driver hitting the endpoint twice.
      const activeExisting = await tx.trip.findFirst({
        where: { routeId: route.id, status: "ACTIVE" },
        select: { id: true, driverId: true },
      });
      if (activeExisting) {
        throw new TripAlreadyActiveError();
      }

      return tx.trip.create({
        data: {
          schoolId: authed.driver.schoolId,
          routeId: route.id,
          driverId: authed.driver.id,
          vehicleId: route.vehicleId!,
          status: "ACTIVE",
          startedAt: now,
        },
      });
    });

    return NextResponse.json({ trip }, { status: 201 });
  } catch (err) {
    if (err instanceof TripAlreadyActiveError) {
      return NextResponse.json({ error: "A trip is already active on this route", code: "TRIP_ALREADY_ACTIVE" }, { status: 409 });
    }
    throw err;
  }
}
