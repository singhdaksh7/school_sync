import { beforeEach, describe, expect, it, vi } from "vitest";

// ── /api/schools/[schoolId]/transport/{routes,vehicles,drivers} — server enforcement ─
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  canAccessSchool: vi.fn(async () => true),
  canWriteSchool: vi.fn(async () => true),
  hasPrismaErrorCode: (err: unknown, code: string) => (err as { code?: unknown })?.code === code,
  sessionRole: (user: unknown) => (user as { role?: string })?.role,
  vehicleBelongsToSchool: vi.fn(async () => true),
  driverBelongsToSchool: vi.fn(async () => true),
  studentBelongsToSchool: vi.fn(async () => true),
}));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    route: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "route-1", isActive: true, ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "route-1", ...args.data })),
      delete: vi.fn(async () => ({ id: "route-1" })),
      count: vi.fn(async () => 0),
    },
    vehicle: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "vehicle-1", isActive: true, ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "vehicle-1", ...args.data })),
      delete: vi.fn(async () => ({ id: "vehicle-1" })),
    },
    driver: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "driver-1", isActive: true, ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "driver-1", ...args.data })),
      delete: vi.fn(async () => ({ id: "driver-1" })),
    },
  },
}));

import { auth } from "@/lib/auth";
import { canAccessSchool, canWriteSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const canAccessMock = canAccessSchool as unknown as ReturnType<typeof vi.fn>;
const canWriteMock = canWriteSchool as unknown as ReturnType<typeof vi.fn>;
const featureFlagMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;

const p = prisma as unknown as {
  route: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  vehicle: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  driver: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const PARAMS = { params: Promise.resolve({ schoolId: "school-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1", role: "SCHOOL_ADMIN" } });
  canAccessMock.mockResolvedValue(true);
  canWriteMock.mockResolvedValue(true);
  featureFlagMock.mockResolvedValue(null);
  p.route.findMany.mockResolvedValue([]);
  p.route.findFirst.mockResolvedValue(null);
  p.route.count.mockResolvedValue(0);
});

describe("GET /api/schools/[schoolId]/transport/routes — tenancy + feature gating", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/schools/[schoolId]/transport/routes/route");
    const res = await GET(jsonReq("http://localhost/api/schools/school-1/transport/routes", "GET"), PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the actor cannot access this school (cross-tenant)", async () => {
    canAccessMock.mockResolvedValue(false);
    const { GET } = await import("@/app/api/schools/[schoolId]/transport/routes/route");
    const res = await GET(jsonReq("http://localhost/api/schools/school-1/transport/routes", "GET"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the TRANSPORT feature flag is disabled for this school", async () => {
    const { NextResponse } = await import("next/server");
    featureFlagMock.mockResolvedValue(NextResponse.json({ error: "Transport is not enabled for this school's plan" }, { status: 403 }));
    const { GET } = await import("@/app/api/schools/[schoolId]/transport/routes/route");
    const res = await GET(jsonReq("http://localhost/api/schools/school-1/transport/routes", "GET"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("lists routes scoped to the school (schoolId passed straight through to the query)", async () => {
    const { GET } = await import("@/app/api/schools/[schoolId]/transport/routes/route");
    await GET(jsonReq("http://localhost/api/schools/school-1/transport/routes", "GET"), PARAMS);
    expect(p.route.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { schoolId: "school-1" } }));
  });
});

describe("POST /api/schools/[schoolId]/transport/routes — create + write permission", () => {
  it("rejects a VICE_PRINCIPAL (read-only role) from creating a route", async () => {
    authMock.mockResolvedValue({ user: { id: "user-2", role: "VICE_PRINCIPAL" } });
    canWriteMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/route");
    const res = await POST(jsonReq("http://localhost/api/schools/school-1/transport/routes", "POST", { name: "Route A" }), PARAMS);
    expect(res.status).toBe(403);
    expect(p.route.create).not.toHaveBeenCalled();
  });

  it("rejects an empty route name with 400", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/route");
    const res = await POST(jsonReq("http://localhost/api/schools/school-1/transport/routes", "POST", { name: "   " }), PARAMS);
    expect(res.status).toBe(400);
    expect(p.route.create).not.toHaveBeenCalled();
  });

  it("creates a route scoped to schoolId and returns 201", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/route");
    const res = await POST(jsonReq("http://localhost/api/schools/school-1/transport/routes", "POST", { name: "Route A", description: "North loop" }), PARAMS);
    expect(res.status).toBe(201);
    expect(p.route.create).toHaveBeenCalledWith({ data: { schoolId: "school-1", name: "Route A", description: "North loop" } });
  });
});

describe("DELETE /api/schools/[schoolId]/transport/vehicles/[vehicleId] — in-use guard", () => {
  it("blocks deleting a vehicle still assigned to a route", async () => {
    p.vehicle.findFirst.mockResolvedValue({ id: "vehicle-1" });
    p.route.count.mockResolvedValue(1);
    const { DELETE } = await import("@/app/api/schools/[schoolId]/transport/vehicles/[vehicleId]/route");
    const res = await DELETE(jsonReq("http://localhost/x", "DELETE"), { params: Promise.resolve({ schoolId: "school-1", vehicleId: "vehicle-1" }) });
    expect(res.status).toBe(409);
    expect(p.vehicle.delete).not.toHaveBeenCalled();
  });

  it("allows deleting a vehicle with no route assignments", async () => {
    p.vehicle.findFirst.mockResolvedValue({ id: "vehicle-1" });
    p.route.count.mockResolvedValue(0);
    const { DELETE } = await import("@/app/api/schools/[schoolId]/transport/vehicles/[vehicleId]/route");
    const res = await DELETE(jsonReq("http://localhost/x", "DELETE"), { params: Promise.resolve({ schoolId: "school-1", vehicleId: "vehicle-1" }) });
    expect(res.status).toBe(200);
    expect(p.vehicle.delete).toHaveBeenCalledWith({ where: { id: "vehicle-1" } });
  });
});

describe("DELETE /api/schools/[schoolId]/transport/drivers/[driverId] — in-use guard", () => {
  it("blocks deleting a driver still assigned to a route", async () => {
    p.driver.findFirst.mockResolvedValue({ id: "driver-1" });
    p.route.count.mockResolvedValue(2);
    const { DELETE } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await DELETE(jsonReq("http://localhost/x", "DELETE"), { params: Promise.resolve({ schoolId: "school-1", driverId: "driver-1" }) });
    expect(res.status).toBe(409);
    expect(p.driver.delete).not.toHaveBeenCalled();
  });
});

describe("POST /api/schools/[schoolId]/transport/drivers — password is hashed, never stored plain", () => {
  it("hashes a provided password before create and never trusts it to bypass validation", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/drivers/route");
    const res = await POST(
      jsonReq("http://localhost/api/schools/school-1/transport/drivers", "POST", { name: "Ravi", phone: "9990001111", password: "supersecret1" }),
      PARAMS
    );
    expect(res.status).toBe(201);
    const createArgs = p.driver.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArgs.data.passwordHash).toBeTypeOf("string");
    expect(createArgs.data.passwordHash).not.toBe("supersecret1");
  });

  it("rejects a driver with no phone", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/drivers/route");
    const res = await POST(jsonReq("http://localhost/api/schools/school-1/transport/drivers", "POST", { name: "Ravi" }), PARAMS);
    expect(res.status).toBe(400);
    expect(p.driver.create).not.toHaveBeenCalled();
  });
});
