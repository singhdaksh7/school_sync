import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { getTeacherAssignments } from "@/lib/homework";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { readTripLocation } from "@/lib/location-store";

/**
 * Active trips, restricted to routes carrying at least one student the
 * TEACHER actually teaches — section-scoped via getTeacherAssignments
 * (src/lib/homework.ts), the same helper class-dashboard/notebook/homework
 * routes already use to determine "sections this teacher teaches" (mentor
 * section + timetable-slot sections). This is NOT school-wide: a teacher
 * with no assignments sees no routes, full stop — no unrestricted-by-default
 * fallback here (unlike the separate custom-role RBAC layer in
 * teacher-permissions.ts, which is a different, opt-in scoping mechanism for
 * delegated admin capabilities, not "which students does this teacher teach").
 */
export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(teacherAuth.schoolId, "TRANSPORT");
  if (featureDenied) return featureDenied;

  const rateLimited = await enforceActorRateLimit({ schoolId: teacherAuth.schoolId, actorType: "TEACHER", actorId: teacherAuth.teacherId }, "STANDARD_READ");
  if (rateLimited) return rateLimited;

  const assignments = await getTeacherAssignments(teacherAuth.teacherId, teacherAuth.schoolId);
  const sectionIds = [...new Set(assignments.map((a) => a.sectionId))];
  if (sectionIds.length === 0) return NextResponse.json({ trips: [] });

  const routeAssignments = await prisma.studentRouteAssignment.findMany({
    where: { schoolId: teacherAuth.schoolId, student: { sectionId: { in: sectionIds } } },
    select: { routeId: true },
    distinct: ["routeId"],
  });
  const routeIds = routeAssignments.map((r) => r.routeId);
  if (routeIds.length === 0) return NextResponse.json({ trips: [] });

  const trips = await prisma.trip.findMany({
    where: { schoolId: teacherAuth.schoolId, routeId: { in: routeIds }, status: "ACTIVE" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      route: { select: { id: true, name: true } },
    },
  });

  const result = await Promise.all(
    trips.map(async (trip) => {
      const locationResult = await readTripLocation(trip.id);
      // PRIVACY: coordinates only ever attached for an ACTIVE trip — every
      // trip in this list is already filtered to status "ACTIVE" above, so
      // this branch never needs to strip coordinates for an ended trip; a
      // trip that ends simply drops out of this query on the next poll.
      return {
        id: trip.id,
        status: trip.status,
        startedAt: trip.startedAt,
        endedAt: trip.endedAt,
        route: trip.route,
        location: locationResult.ok ? locationResult.location : null,
      };
    })
  );

  return NextResponse.json({ trips: result });
}
