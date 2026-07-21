import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-driver-routes-suite";

vi.mock("@/lib/driver-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/driver-auth")>("@/lib/driver-auth");
  return { ...actual, getAuthenticatedDriver: vi.fn() };
});
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/location-store", () => ({ writeTripLocation: vi.fn(), readTripLocation: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 })),
  RATE_LIMIT_POLICIES: { authIp: { limit: 200, windowMs: 900000 }, login: { limit: 8, windowMs: 900000 } },
}));
vi.mock("@/lib/school-resolver", () => ({ hostnameFromHeaders: vi.fn(() => null), resolveSchool: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: { findMany: vi.fn() },
    route: { findFirst: vi.fn(), findMany: vi.fn() },
    trip: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txHandle)),
  },
}));

import { prisma } from "@/lib/prisma";
import { getAuthenticatedDriver } from "@/lib/driver-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { writeTripLocation } from "@/lib/location-store";

const p = prisma as unknown as {
  driver: { findMany: ReturnType<typeof vi.fn> };
  route: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  trip: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
};

// A minimal transaction-client stand-in used by the mocked $transaction above.
const txHandle = {
  trip: {
    findFirst: (...args: unknown[]) => p.trip.findFirst(...(args as [unknown])),
    create: (...args: unknown[]) => p.trip.create(...(args as [unknown])),
  },
};

const getAuthMock = getAuthenticatedDriver as unknown as ReturnType<typeof vi.fn>;
const featureFlagMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const rateLimitMock = enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;
const writeLocationMock = writeTripLocation as unknown as ReturnType<typeof vi.fn>;

const DRIVER_AUTH = { decoded: { driverId: "driver-1", role: "DRIVER" as const }, driver: { id: "driver-1", schoolId: "school-a", name: "Ravi", phone: "999", email: null, isActive: true, school: { id: "school-a", slug: "school-a", status: "ACTIVE" } } };

function jsonReq(url: string, method: string, body?: unknown, token = "x") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthMock.mockResolvedValue(DRIVER_AUTH);
  featureFlagMock.mockResolvedValue(null);
  rateLimitMock.mockResolvedValue(null);
  p.driver.findMany.mockResolvedValue([]);
});

describe("GET /api/mobile/driver/route — no student PII leak", () => {
  it("returns only stop name, sequence, and a numeric studentCount — never names/ids/contacts", async () => {
    p.route.findMany.mockResolvedValue([
      {
        id: "route-1",
        name: "North Loop",
        description: null,
        isActive: true,
        vehicle: { id: "v1", registrationNumber: "KA-01", capacity: 40 },
        stops: [{ id: "stop-1", name: "Gate A", sequence: 1, latitude: 1, longitude: 1, _count: { studentAssignments: 3 } }],
      },
    ]);
    const { GET } = await import("@/app/api/mobile/driver/route/route");
    const res = await GET(jsonReq("http://localhost/api/mobile/driver/route", "GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const raw = JSON.stringify(body);
    expect(body.routes[0].stops[0]).toEqual({ id: "stop-1", name: "Gate A", sequence: 1, latitude: 1, longitude: 1, studentCount: 3 });
    // No PII field name anywhere in the payload.
    expect(raw).not.toMatch(/studentName|"studentId"|rollNo|"phone"|"email".*student/i);
  });

  it("rejects when unauthenticated", async () => {
    getAuthMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/mobile/driver/route/route");
    const res = await GET(jsonReq("http://localhost/api/mobile/driver/route", "GET"));
    expect(res.status).toBe(401);
  });

  it("rejects when TRANSPORT feature flag is off", async () => {
    const { NextResponse } = await import("next/server");
    featureFlagMock.mockResolvedValue(NextResponse.json({ error: "off" }, { status: 403 }));
    const { GET } = await import("@/app/api/mobile/driver/route/route");
    const res = await GET(jsonReq("http://localhost/api/mobile/driver/route", "GET"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/mobile/driver/trips/start — ownership + double-start", () => {
  it("404s when the route doesn't belong to this driver/school", async () => {
    p.route.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/mobile/driver/trips/start/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { routeId: "route-1" }));
    expect(res.status).toBe(404);
    expect(p.route.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "route-1", schoolId: "school-a", driverId: "driver-1" } }));
  });

  it("starts a trip and returns 201 when no ACTIVE trip exists on the route", async () => {
    p.route.findFirst.mockResolvedValue({ id: "route-1", vehicleId: "v1", isActive: true });
    p.trip.findFirst.mockResolvedValue(null);
    p.trip.create.mockResolvedValue({ id: "trip-1", status: "ACTIVE" });
    const { POST } = await import("@/app/api/mobile/driver/trips/start/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { routeId: "route-1" }));
    expect(res.status).toBe(201);
  });

  it("double-start (an ACTIVE trip already exists on this route) is rejected with 409, not a crash", async () => {
    p.route.findFirst.mockResolvedValue({ id: "route-1", vehicleId: "v1", isActive: true });
    p.trip.findFirst.mockResolvedValue({ id: "trip-existing", driverId: "driver-1" });
    const { POST } = await import("@/app/api/mobile/driver/trips/start/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { routeId: "route-1" }));
    expect(res.status).toBe(409);
    expect(p.trip.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/driver/trips/[tripId]/end — ownership + double-end", () => {
  it("403s when the trip belongs to a different driver", async () => {
    p.trip.findFirst.mockResolvedValue({ id: "trip-1", driverId: "driver-OTHER", status: "ACTIVE" });
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/end/route");
    const res = await POST(jsonReq("http://localhost/x", "POST"), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(403);
    expect(p.trip.updateMany).not.toHaveBeenCalled();
  });

  it("ends an ACTIVE trip owned by this driver", async () => {
    p.trip.findFirst.mockResolvedValue({ id: "trip-1", driverId: "driver-1", status: "ACTIVE" });
    p.trip.updateMany.mockResolvedValue({ count: 1 });
    p.trip.findUnique.mockResolvedValue({ id: "trip-1", status: "COMPLETED" });
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/end/route");
    const res = await POST(jsonReq("http://localhost/x", "POST"), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(200);
  });

  it("double-end (trip already COMPLETED) is rejected with 409, not a crash", async () => {
    p.trip.findFirst.mockResolvedValue({ id: "trip-1", driverId: "driver-1", status: "COMPLETED" });
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/end/route");
    const res = await POST(jsonReq("http://localhost/x", "POST"), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(409);
    expect(p.trip.updateMany).not.toHaveBeenCalled();
  });

  it("404s for a trip in another school (not just another driver)", async () => {
    p.trip.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/end/route");
    const res = await POST(jsonReq("http://localhost/x", "POST"), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(404);
    expect(p.trip.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "trip-1", schoolId: "school-a" } }));
  });
});

describe("POST /api/mobile/driver/trips/[tripId]/ping", () => {
  beforeEach(() => {
    p.trip.findFirst.mockResolvedValue({ id: "trip-1", driverId: "driver-1", status: "ACTIVE" });
  });

  it("writes to the location store and returns ok:true on success", async () => {
    writeLocationMock.mockResolvedValue({ ok: true });
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/ping/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { lat: 12.9, lng: 77.6 }), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 503 (not a false success) when the location store is unavailable", async () => {
    writeLocationMock.mockResolvedValue({ ok: false, reason: "REDIS_UNAVAILABLE" });
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/ping/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { lat: 12.9, lng: 77.6 }), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBeUndefined();
    expect(body.code).toBe("LOCATION_STORE_UNAVAILABLE");
  });

  it("rejects (no write) when the trip is not ACTIVE", async () => {
    p.trip.findFirst.mockResolvedValue({ id: "trip-1", driverId: "driver-1", status: "COMPLETED" });
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/ping/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { lat: 12.9, lng: 77.6 }), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(409);
    expect(writeLocationMock).not.toHaveBeenCalled();
  });

  it("rejects (no write) when the trip belongs to another driver", async () => {
    p.trip.findFirst.mockResolvedValue({ id: "trip-1", driverId: "driver-OTHER", status: "ACTIVE" });
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/ping/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { lat: 12.9, lng: 77.6 }), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(403);
    expect(writeLocationMock).not.toHaveBeenCalled();
  });

  it("rejects invalid lat/lng payloads with 400 before touching the store", async () => {
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/ping/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { lat: "not-a-number", lng: 77.6 }), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(400);
    expect(writeLocationMock).not.toHaveBeenCalled();
  });

  it("rejects when unauthenticated", async () => {
    getAuthMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/mobile/driver/trips/[tripId]/ping/route");
    const res = await POST(jsonReq("http://localhost/x", "POST", { lat: 1, lng: 1 }), { params: Promise.resolve({ tripId: "trip-1" }) });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/mobile/driver/login", () => {
  it("rejects a driver with the wrong password (generic, enumeration-safe message)", async () => {
    const bcrypt = await import("bcryptjs");
    p.driver.findMany.mockResolvedValue([
      { id: "driver-1", schoolId: "school-a", name: "Ravi", phone: "999", email: null, isActive: true, passwordHash: await bcrypt.hash("correct", 4), school: { id: "school-a", name: "S", slug: "school-a", logoUrl: null, status: "ACTIVE" } },
    ]);
    const { POST } = await import("@/app/api/mobile/driver/login/route");
    const res = await POST(jsonReq("http://localhost/api/mobile/driver/login", "POST", { phone: "999", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("rejects an unknown phone number", async () => {
    p.driver.findMany.mockResolvedValue([]);
    const { POST } = await import("@/app/api/mobile/driver/login/route");
    const res = await POST(jsonReq("http://localhost/api/mobile/driver/login", "POST", { phone: "000", password: "x" }));
    expect(res.status).toBe(401);
  });

  it("issues a token for a correct phone+password", async () => {
    const bcrypt = await import("bcryptjs");
    p.driver.findMany.mockResolvedValue([
      { id: "driver-1", schoolId: "school-a", name: "Ravi", phone: "999", email: null, isActive: true, passwordHash: await bcrypt.hash("correct", 4), school: { id: "school-a", name: "S", slug: "school-a", logoUrl: null, status: "ACTIVE" } },
    ]);
    const { POST } = await import("@/app/api/mobile/driver/login/route");
    const res = await POST(jsonReq("http://localhost/api/mobile/driver/login", "POST", { phone: "999", password: "correct" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
  });
});
