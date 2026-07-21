import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Stop sequencing, vehicle/driver assignment, student assignment ──────────
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
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
      findFirst: vi.fn(async () => ({ id: "route-1" })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "route-1", vehicleId: null, driverId: null, ...args.data })),
    },
    stop: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "stop-new", ...args.data })),
    },
    studentRouteAssignment: {
      upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({ id: "sra-1", ...args.create })),
      findUnique: vi.fn(async () => null),
      delete: vi.fn(async () => ({ id: "sra-1" })),
    },
  },
}));

import { auth } from "@/lib/auth";
import { driverBelongsToSchool, vehicleBelongsToSchool } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const vehicleBelongsMock = vehicleBelongsToSchool as unknown as ReturnType<typeof vi.fn>;
const driverBelongsMock = driverBelongsToSchool as unknown as ReturnType<typeof vi.fn>;

const p = prisma as unknown as {
  route: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  stop: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  studentRouteAssignment: { upsert: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

function jsonReq(body?: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ROUTE_PARAMS = { params: Promise.resolve({ schoolId: "school-1", routeId: "route-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1", role: "SCHOOL_ADMIN" } });
  vehicleBelongsMock.mockResolvedValue(true);
  driverBelongsMock.mockResolvedValue(true);
  p.route.findFirst.mockResolvedValue({ id: "route-1" });
  p.stop.findFirst.mockResolvedValue(null);
});

describe("POST .../stops — sequence auto-assignment", () => {
  it("assigns sequence 1 to the first stop on a route", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/stops/route");
    const res = await POST(jsonReq({ name: "Main Gate" }), ROUTE_PARAMS);
    expect(res.status).toBe(201);
    expect(p.stop.create).toHaveBeenCalledWith({ data: { schoolId: "school-1", routeId: "route-1", name: "Main Gate", sequence: 1, latitude: null, longitude: null } });
  });

  it("appends the next sequence after the existing highest one", async () => {
    p.stop.findFirst.mockResolvedValue({ sequence: 4 });
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/stops/route");
    const res = await POST(jsonReq({ name: "Market Road" }), ROUTE_PARAMS);
    expect(res.status).toBe(201);
    expect(p.stop.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sequence: 5 }) }));
  });

  it("respects an explicit sequence number when provided", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/stops/route");
    const res = await POST(jsonReq({ name: "Detour Stop", sequence: 10 }), ROUTE_PARAMS);
    expect(res.status).toBe(201);
    expect(p.stop.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sequence: 10 }) }));
  });

  it("returns 409 on a duplicate (routeId, sequence) collision", async () => {
    p.stop.create.mockRejectedValueOnce(Object.assign(new Error("unique constraint"), { code: "P2002" }));
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/stops/route");
    const res = await POST(jsonReq({ name: "Dup", sequence: 1 }), ROUTE_PARAMS);
    expect(res.status).toBe(409);
  });

  it("rejects an empty stop name with 400 before touching the database", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/stops/route");
    const res = await POST(jsonReq({ name: "" }), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(p.stop.create).not.toHaveBeenCalled();
  });
});

describe("POST .../assign — vehicle/driver validated against the school", () => {
  it("rejects a vehicleId that does not belong to this school", async () => {
    vehicleBelongsMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/assign/route");
    const res = await POST(jsonReq({ vehicleId: "vehicle-other-school" }), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(p.route.update).not.toHaveBeenCalled();
  });

  it("rejects a driverId that does not belong to this school", async () => {
    driverBelongsMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/assign/route");
    const res = await POST(jsonReq({ driverId: "driver-other-school" }), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(p.route.update).not.toHaveBeenCalled();
  });

  it("allows explicitly unassigning by passing null", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/assign/route");
    const res = await POST(jsonReq({ vehicleId: null, driverId: null }), ROUTE_PARAMS);
    expect(res.status).toBe(200);
    expect(p.route.update).toHaveBeenCalledWith(expect.objectContaining({ data: { vehicleId: null, driverId: null } }));
    // Unassigning must not re-validate a null id against vehicleBelongsToSchool/driverBelongsToSchool.
    expect(vehicleBelongsMock).not.toHaveBeenCalled();
    expect(driverBelongsMock).not.toHaveBeenCalled();
  });

  it("assigns a valid vehicle and driver", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/assign/route");
    const res = await POST(jsonReq({ vehicleId: "vehicle-1", driverId: "driver-1" }), ROUTE_PARAMS);
    expect(res.status).toBe(200);
    expect(p.route.update).toHaveBeenCalledWith(expect.objectContaining({ data: { vehicleId: "vehicle-1", driverId: "driver-1" } }));
  });
});

describe("POST/DELETE .../students — assignment scoped to the route's own stops", () => {
  it("rejects a stopId that belongs to a different route", async () => {
    p.stop.findFirst.mockResolvedValue(null); // simulates the (id, routeId) lookup finding nothing
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/students/route");
    const res = await POST(jsonReq({ studentId: "student-1", stopId: "stop-on-other-route" }), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(p.studentRouteAssignment.upsert).not.toHaveBeenCalled();
  });

  it("assigns a student to the route with a valid stop", async () => {
    p.stop.findFirst.mockResolvedValue({ id: "stop-1" });
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/students/route");
    const res = await POST(jsonReq({ studentId: "student-1", stopId: "stop-1" }), ROUTE_PARAMS);
    expect(res.status).toBe(201);
    expect(p.studentRouteAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId_routeId: { studentId: "student-1", routeId: "route-1" } },
        create: { schoolId: "school-1", studentId: "student-1", routeId: "route-1", stopId: "stop-1" },
      })
    );
  });

  it("assigning without a stopId leaves the student route-only (no specific stop)", async () => {
    const { POST } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/students/route");
    const res = await POST(jsonReq({ studentId: "student-1" }), ROUTE_PARAMS);
    expect(res.status).toBe(201);
    expect(p.studentRouteAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ stopId: null }) }));
  });

  it("returns 404 when unassigning a student who is not on this route", async () => {
    p.studentRouteAssignment.findUnique.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/students/route");
    const res = await DELETE(jsonReq({ studentId: "student-1" }), ROUTE_PARAMS);
    expect(res.status).toBe(404);
    expect(p.studentRouteAssignment.delete).not.toHaveBeenCalled();
  });

  it("unassigns an existing student route assignment", async () => {
    p.studentRouteAssignment.findUnique.mockResolvedValue({ id: "sra-1" });
    const { DELETE } = await import("@/app/api/schools/[schoolId]/transport/routes/[routeId]/students/route");
    const res = await DELETE(jsonReq({ studentId: "student-1" }), ROUTE_PARAMS);
    expect(res.status).toBe(200);
    expect(p.studentRouteAssignment.delete).toHaveBeenCalledWith({ where: { id: "sra-1" } });
  });
});
