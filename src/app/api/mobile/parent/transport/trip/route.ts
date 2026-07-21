import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { readTripLocation } from "@/lib/location-store";

/**
 * Active trip (+ latest Redis location, ACTIVE trips only) for the routes
 * the guardian's OWN children are assigned to. The child->route link is
 * re-verified from the database on every single request/poll (the query
 * below is scoped by guardianId on every call, never cached from session
 * start) — a child reassigned to a different route between two polls is
 * reflected on the very next poll.
 *
 * PRIVACY (hard constraint): coordinates are only ever attached while
 * Trip.status === "ACTIVE". A completed/cancelled/scheduled trip is returned
 * as trip-ended metadata with NO coordinates — never a frozen last-known
 * position. There is no history endpoint anywhere in this feature.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(auth.guardian.schoolId, "TRANSPORT");
  if (featureDenied) return featureDenied;

  const rateLimited = await enforceActorRateLimit({ schoolId: auth.guardian.schoolId, actorType: "PARENT", actorId: auth.guardian.id }, "STANDARD_READ");
  if (rateLimited) return rateLimited;

  const studentIdParam = req.nextUrl.searchParams.get("studentId");

  // Every route/stop/trip lookup below is scoped by BOTH the guardian's own
  // id AND schoolId, so this can never cross a tenant or another family's
  // children, regardless of what studentId is supplied.
  const assignments = await prisma.studentRouteAssignment.findMany({
    where: {
      schoolId: auth.guardian.schoolId,
      student: { guardianLinks: { some: { guardianId: auth.guardian.id } } },
      ...(studentIdParam ? { studentId: studentIdParam } : {}),
    },
    select: {
      studentId: true,
      student: { select: { id: true, name: true } },
      routeId: true,
      route: { select: { id: true, name: true } },
      stop: { select: { id: true, name: true, sequence: true } },
    },
  });

  const children = await Promise.all(
    assignments.map(async (assignment) => {
      const trip = await prisma.trip.findFirst({
        where: { schoolId: auth.guardian.schoolId, routeId: assignment.routeId, status: "ACTIVE" },
        select: { id: true, status: true, startedAt: true, endedAt: true },
      });

      let location: { lat: number; lng: number; updatedAt: string } | null = null;
      if (trip) {
        const locationResult = await readTripLocation(trip.id);
        if (locationResult.ok) location = locationResult.location;
        // If the location store is unavailable, we still return trip status
        // — just without coordinates, never a stale/fake position.
      }

      return {
        studentId: assignment.studentId,
        studentName: assignment.student.name,
        route: { id: assignment.route.id, name: assignment.route.name },
        stop: assignment.stop ? { id: assignment.stop.id, name: assignment.stop.name, sequence: assignment.stop.sequence } : null,
        trip: trip
          ? { id: trip.id, status: trip.status, startedAt: trip.startedAt, endedAt: trip.endedAt }
          : { id: null, status: "NO_ACTIVE_TRIP" as const, startedAt: null, endedAt: null },
        // Coordinates ONLY while the trip is ACTIVE — enforced structurally,
        // not just by convention: `location` is only ever populated inside
        // the `if (trip)` branch above, and `trip` here is always the
        // ACTIVE-status trip (or none).
        location: trip ? location : null,
      };
    })
  );

  return NextResponse.json({ children });
}
