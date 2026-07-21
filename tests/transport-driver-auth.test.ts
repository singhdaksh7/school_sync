import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

process.env.NEXTAUTH_SECRET = "test-secret-for-driver-auth-suite";

// Exercises the REAL getAuthenticatedDriver/verifyDriverToken chain against
// real JWTs (only prisma + validateSession are mocked) — mirrors the pattern
// in teacher-bearer-auth-equivalence.test.ts.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    driver: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth-sessions", () => ({ validateSession: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { validateSession } from "@/lib/auth-sessions";
import { getAuthenticatedDriver, generateDriverToken } from "@/lib/driver-auth";

const p = prisma as unknown as { driver: { findFirst: ReturnType<typeof vi.fn> } };
const validateSessionMock = validateSession as unknown as ReturnType<typeof vi.fn>;

const DRIVER_ROW = {
  id: "driver-1",
  schoolId: "school-a",
  name: "Ravi",
  phone: "9990001111",
  email: null,
  isActive: true,
  school: { id: "school-a", slug: "school-a", status: "ACTIVE" },
};

function bearerReq(token: string) {
  return new NextRequest("http://localhost/api/mobile/driver/me", { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  vi.resetAllMocks();
  p.driver.findFirst.mockResolvedValue(DRIVER_ROW);
});

describe("getAuthenticatedDriver — token validity", () => {
  it("rejects a request with no Authorization header", async () => {
    const result = await getAuthenticatedDriver(new NextRequest("http://localhost/api/mobile/driver/me"));
    expect(result).toBeNull();
  });

  it("rejects a garbage/invalid token", async () => {
    const result = await getAuthenticatedDriver(bearerReq("not-a-real-token"));
    expect(result).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign(
      { driverId: "driver-1", name: "Ravi", phone: "9990001111", role: "DRIVER", schoolId: "school-a", schoolSlug: "school-a" },
      process.env.NEXTAUTH_SECRET!,
      { expiresIn: -10 }
    );
    const result = await getAuthenticatedDriver(bearerReq(expired));
    expect(result).toBeNull();
  });

  it("rejects a token with the wrong role (e.g. a mobile Teacher/Student token reused here)", async () => {
    const wrongRole = jwt.sign(
      { driverId: "driver-1", name: "Ravi", phone: "9990001111", role: "TEACHER", schoolId: "school-a", schoolSlug: "school-a" },
      process.env.NEXTAUTH_SECRET!
    );
    const result = await getAuthenticatedDriver(bearerReq(wrongRole));
    expect(result).toBeNull();
  });

  it("accepts a valid driver token and resolves the driver scoped to schoolId", async () => {
    const token = generateDriverToken({ driverId: "driver-1", name: "Ravi", phone: "9990001111", role: "DRIVER", schoolId: "school-a", schoolSlug: "school-a" });
    const result = await getAuthenticatedDriver(bearerReq(token));
    expect(result?.driver.id).toBe("driver-1");
    expect(p.driver.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "driver-1", schoolId: "school-a" } }));
  });

  it("rejects when the driver's school is suspended, even with a valid token", async () => {
    p.driver.findFirst.mockResolvedValue({ ...DRIVER_ROW, school: { ...DRIVER_ROW.school, status: "SUSPENDED" } });
    const token = generateDriverToken({ driverId: "driver-1", name: "Ravi", phone: "9990001111", role: "DRIVER", schoolId: "school-a", schoolSlug: "school-a" });
    const result = await getAuthenticatedDriver(bearerReq(token));
    expect(result).toBeNull();
  });

  it("rejects when the driver has been deactivated", async () => {
    p.driver.findFirst.mockResolvedValue({ ...DRIVER_ROW, isActive: false });
    const token = generateDriverToken({ driverId: "driver-1", name: "Ravi", phone: "9990001111", role: "DRIVER", schoolId: "school-a", schoolSlug: "school-a" });
    const result = await getAuthenticatedDriver(bearerReq(token));
    expect(result).toBeNull();
  });

  it("rejects a driver id/school pairing that doesn't exist for this school (cross-school token reuse)", async () => {
    p.driver.findFirst.mockResolvedValue(null);
    const token = generateDriverToken({ driverId: "driver-1", name: "Ravi", phone: "9990001111", role: "DRIVER", schoolId: "school-b", schoolSlug: "school-b" });
    const result = await getAuthenticatedDriver(bearerReq(token));
    expect(result).toBeNull();
    expect(p.driver.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "driver-1", schoolId: "school-b" } }));
  });

  it("when a token carries a sid, validates it against the session store and rejects if revoked/expired", async () => {
    validateSessionMock.mockResolvedValue({ valid: false, session: null, reason: "REVOKED" });
    const token = generateDriverToken({ driverId: "driver-1", name: "Ravi", phone: "9990001111", role: "DRIVER", schoolId: "school-a", schoolSlug: "school-a", sid: "some-sid" });
    const result = await getAuthenticatedDriver(bearerReq(token));
    expect(result).toBeNull();
    expect(validateSessionMock).toHaveBeenCalledWith("some-sid", expect.any(Date));
  });
});
