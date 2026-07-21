import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedDriver } from "@/lib/driver-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { writeTripLocation } from "@/lib/location-store";
import { systemClock } from "@/lib/clock";

/**
 * Location ping — accepts {lat, lng}, writes to the Redis latest-position
 * store (src/lib/location-store.ts). Deliberately NOT audit-logged (product
 * decision per the task: pings are high-frequency telemetry, not an
 * auditable action — TRANSPORT_TRIP_STARTED/ENDED are audited, pings never
 * are, and no "ping" AuditAction exists).
 *
 * Redis-unavailability handling: if the write fails (no distributed backend
 * configured, or the Redis command itself errors), this returns 503 with a
 * machine-readable code and does NOT report 200/success. A driver app that
 * gets 503 here should keep the ping queued client-side and retry — it must
 * never be told "ok" for a write that didn't happen, since that would mean
 * the live map silently goes stale with no signal to anyone. This is a
 * deliberate fail-CLOSED choice (unlike most of this codebase's rate/cost
 * guards, which fail open) because the alternative — reporting success while
 * writing nothing — is a silent, undetectable data loss for a live safety
 * feature (parents/teachers trusting a "live" position that's actually
 * frozen).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const authed = await getAuthenticatedDriver(req);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(authed.driver.schoolId, "TRANSPORT");
  if (featureDenied) return featureDenied;

  const rateLimited = await enforceActorRateLimit({ schoolId: authed.driver.schoolId, actorType: "DRIVER", actorId: authed.driver.id }, "LOCATION_PING");
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const lat = (body as { lat?: unknown })?.lat;
  const lng = (body as { lng?: unknown })?.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required numbers" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "lat/lng out of range" }, { status: 400 });
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, schoolId: authed.driver.schoolId },
    select: { id: true, driverId: true, status: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (trip.driverId !== authed.driver.id) {
    return NextResponse.json({ error: "You are not assigned to this trip" }, { status: 403 });
  }
  if (trip.status !== "ACTIVE") {
    return NextResponse.json({ error: "Trip is not active", code: "TRIP_NOT_ACTIVE" }, { status: 409 });
  }

  const result = await writeTripLocation(trip.id, lat, lng, systemClock.now());
  if (!result.ok) {
    return NextResponse.json({ error: "Location service temporarily unavailable", code: "LOCATION_STORE_UNAVAILABLE" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
