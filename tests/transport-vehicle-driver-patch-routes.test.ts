import { beforeEach, describe, expect, it, vi } from "vitest";

// ── PATCH /api/schools/[schoolId]/transport/{vehicles,drivers}/[id] — edit UI's backend ─
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  canWriteSchool: vi.fn(async () => true),
  hasPrismaErrorCode: (err: unknown, code: string) => (err as { code?: unknown })?.code === code,
  sessionRole: (user: unknown) => (user as { role?: string })?.role,
}));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    vehicle: {
      findFirst: vi.fn(async () => ({ id: "vehicle-1" })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "vehicle-1", isActive: true, ...args.data })),
    },
    driver: {
      findFirst: vi.fn(async () => ({ id: "driver-1" })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "driver-1", isActive: true, ...args.data })),
    },
  },
}));

import { auth } from "@/lib/auth";
import { canWriteSchool } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const canWriteMock = canWriteSchool as unknown as ReturnType<typeof vi.fn>;

const p = prisma as unknown as {
  vehicle: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  driver: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

function patchReq(body: unknown) {
  return new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1", role: "SCHOOL_ADMIN" } });
  canWriteMock.mockResolvedValue(true);
  p.vehicle.findFirst.mockResolvedValue({ id: "vehicle-1" });
  p.driver.findFirst.mockResolvedValue({ id: "driver-1" });
});

describe("PATCH /api/schools/[schoolId]/transport/vehicles/[vehicleId]", () => {
  const PARAMS = { params: Promise.resolve({ schoolId: "school-1", vehicleId: "vehicle-1" }) };

  it("rejects a VICE_PRINCIPAL (read-only role) from editing a vehicle", async () => {
    canWriteMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/vehicles/[vehicleId]/route");
    const res = await PATCH(patchReq({ model: "New Model" }), PARAMS);
    expect(res.status).toBe(403);
    expect(p.vehicle.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a vehicle that doesn't belong to this school", async () => {
    p.vehicle.findFirst.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/vehicles/[vehicleId]/route");
    const res = await PATCH(patchReq({ model: "New Model" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("rejects clearing the registration number to blank", async () => {
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/vehicles/[vehicleId]/route");
    const res = await PATCH(patchReq({ registrationNumber: "   " }), PARAMS);
    expect(res.status).toBe(400);
    expect(p.vehicle.update).not.toHaveBeenCalled();
  });

  it("updates model, capacity, and isActive together", async () => {
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/vehicles/[vehicleId]/route");
    const res = await PATCH(patchReq({ model: "Tata Starbus", capacity: 42, isActive: false }), PARAMS);
    expect(res.status).toBe(200);
    expect(p.vehicle.update).toHaveBeenCalledWith({
      where: { id: "vehicle-1" },
      data: { model: "Tata Starbus", capacity: 42, isActive: false },
    });
  });

  it("returns 409 with DUPLICATE_REGISTRATION on a unique-constraint collision", async () => {
    p.vehicle.update.mockRejectedValueOnce(Object.assign(new Error("unique constraint"), { code: "P2002" }));
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/vehicles/[vehicleId]/route");
    const res = await PATCH(patchReq({ registrationNumber: "KA-01-AB-0001" }), PARAMS);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("DUPLICATE_REGISTRATION");
  });
});

describe("PATCH /api/schools/[schoolId]/transport/drivers/[driverId]", () => {
  const PARAMS = { params: Promise.resolve({ schoolId: "school-1", driverId: "driver-1" }) };

  it("rejects a VICE_PRINCIPAL (read-only role) from editing a driver", async () => {
    canWriteMock.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ phone: "9990001111" }), PARAMS);
    expect(res.status).toBe(403);
    expect(p.driver.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a driver that doesn't belong to this school", async () => {
    p.driver.findFirst.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ phone: "9990001111" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("updates name and phone", async () => {
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ name: "Ramesh Kumar", phone: "9990001111" }), PARAMS);
    expect(res.status).toBe(200);
    expect(p.driver.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "driver-1" }, data: { name: "Ramesh Kumar", phone: "9990001111" } })
    );
  });

  it("returns 409 with DUPLICATE_PHONE on a unique-constraint collision", async () => {
    p.driver.update.mockRejectedValueOnce(Object.assign(new Error("unique constraint"), { code: "P2002" }));
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ phone: "9990001111" }), PARAMS);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("DUPLICATE_PHONE");
  });

  // ── The password-blank-must-not-clobber contract the edit UI depends on ──
  it("omitting the password field never touches passwordHash", async () => {
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ name: "Ramesh Kumar" }), PARAMS);
    expect(res.status).toBe(200);
    const data = p.driver.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("an empty-string password never touches passwordHash (edit UI sends this when the field is left blank)", async () => {
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ name: "Ramesh Kumar", password: "" }), PARAMS);
    expect(res.status).toBe(200);
    const data = p.driver.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("a password shorter than 8 characters is silently ignored, not rejected, and does not touch passwordHash", async () => {
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ password: "short" }), PARAMS);
    expect(res.status).toBe(200);
    const data = p.driver.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("a password of 8+ characters is hashed and included as passwordHash, never stored plain", async () => {
    const { PATCH } = await import("@/app/api/schools/[schoolId]/transport/drivers/[driverId]/route");
    const res = await PATCH(patchReq({ password: "newsecret1" }), PARAMS);
    expect(res.status).toBe(200);
    const data = p.driver.update.mock.calls[0][0].data;
    expect(data.passwordHash).toBeTypeOf("string");
    expect(data.passwordHash).not.toBe("newsecret1");
  });
});
