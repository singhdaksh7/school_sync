import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedDriver } from "@/lib/driver-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

/**
 * The driver's assigned route(s) with stops in sequence.
 *
 * PRIVACY (hard constraint): only stop name, sequence, and a STUDENT COUNT per
 * stop are ever returned. No student names, ids, contact details, or photos —
 * here or anywhere else in the driver-facing surface of this task.
 */
export async function GET(req: NextRequest) {
  const authed = await getAuthenticatedDriver(req);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(authed.driver.schoolId, "TRANSPORT");
  if (featureDenied) return featureDenied;

  const rateLimited = await enforceActorRateLimit({ schoolId: authed.driver.schoolId, actorType: "DRIVER", actorId: authed.driver.id }, "STANDARD_READ");
  if (rateLimited) return rateLimited;

  const routes = await prisma.route.findMany({
    where: { schoolId: authed.driver.schoolId, driverId: authed.driver.id },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      vehicle: { select: { id: true, registrationNumber: true, capacity: true } },
      stops: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          name: true,
          sequence: true,
          latitude: true,
          longitude: true,
          _count: { select: { studentAssignments: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      description: route.description,
      isActive: route.isActive,
      vehicle: route.vehicle,
      stops: route.stops.map((stop) => ({
        id: stop.id,
        name: stop.name,
        sequence: stop.sequence,
        latitude: stop.latitude,
        longitude: stop.longitude,
        studentCount: stop._count.studentAssignments,
      })),
    })),
  });
}
