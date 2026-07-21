/**
 * Redis latest-position store for active trips (Transport Phase B).
 *
 * Key shape: `trip:{tripId}:location` -> JSON `{lat, lng, updatedAt}`, TTL
 * ~90s. The TTL is a STALENESS SAFEGUARD, not a real expiry/retention
 * policy — there is deliberately no location HISTORY anywhere in this
 * feature (see the parent/teacher live-view endpoints): once a ping is
 * older than 90s with no fresher one behind it, the key simply disappears
 * and callers see "no current location" rather than a stale pin on a map.
 *
 * Reuses the exact same ioredis connection as the distributed rate limiter
 * (src/lib/rate-limit.ts's RedisProtocolRateLimiter, via
 * getSharedRedisProtocolClient()) instead of opening a second Redis
 * connection. When no distributed Redis/Valkey backend is configured
 * (local/dev, or an Upstash-REST-only setup with no raw client), every
 * function here degrades explicitly — see each function's return type,
 * never a false "success".
 */

import { getSharedRedisProtocolClient } from "@/lib/rate-limit";

export const LOCATION_TTL_SECONDS = 90;

function locationKey(tripId: string): string {
  return `trip:${tripId}:location`;
}

export interface TripLocation {
  lat: number;
  lng: number;
  updatedAt: string; // ISO timestamp
}

export type WriteLocationResult =
  | { ok: true }
  /** Redis is unavailable (no distributed backend configured, or the write
   * itself failed) — the caller must surface this distinctly, not report success. */
  | { ok: false; reason: "REDIS_UNAVAILABLE" };

/** Writes the latest known position for a trip, with the staleness TTL. */
export async function writeTripLocation(tripId: string, lat: number, lng: number, now: Date): Promise<WriteLocationResult> {
  const client = getSharedRedisProtocolClient();
  if (!client) return { ok: false, reason: "REDIS_UNAVAILABLE" };

  const payload: TripLocation = { lat, lng, updatedAt: now.toISOString() };
  try {
    await client.set(locationKey(tripId), JSON.stringify(payload), "EX", LOCATION_TTL_SECONDS);
    return { ok: true };
  } catch (err) {
    console.error("[location-store] write failed:", err);
    return { ok: false, reason: "REDIS_UNAVAILABLE" };
  }
}

export type ReadLocationResult =
  | { ok: true; location: TripLocation | null }
  | { ok: false; reason: "REDIS_UNAVAILABLE" };

/** Reads the latest known position for a trip. `location: null` means no
 * recent ping (either never pinged, or the 90s staleness TTL expired) — a
 * normal, expected state, distinct from `ok: false` (backend unreachable). */
export async function readTripLocation(tripId: string): Promise<ReadLocationResult> {
  const client = getSharedRedisProtocolClient();
  if (!client) return { ok: false, reason: "REDIS_UNAVAILABLE" };

  try {
    const raw = await client.get(locationKey(tripId));
    if (!raw) return { ok: true, location: null };
    const parsed = JSON.parse(raw) as TripLocation;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number" || typeof parsed.updatedAt !== "string") {
      return { ok: true, location: null };
    }
    return { ok: true, location: parsed };
  } catch (err) {
    console.error("[location-store] read failed:", err);
    return { ok: false, reason: "REDIS_UNAVAILABLE" };
  }
}
