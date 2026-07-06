import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// getSchoolFeatureFlags itself is REAL — this test proves the bootstrap route
// reuses the exact same authoritative resolver every requireSchoolFeature()
// check already uses, not a second/duplicated computation.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    schoolFeatureFlag: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/mobile-auth", () => ({ getMobileAuth: vi.fn() }));
vi.mock("@/lib/parent-auth", () => ({ getAuthenticatedGuardian: vi.fn() }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getMobileAuth } from "@/lib/mobile-auth";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { GET as featuresGet } from "@/app/api/mobile/features/route";

const p = prisma as unknown as { schoolFeatureFlag: { findMany: ReturnType<typeof vi.fn> } };
const getMobileAuthMock = getMobileAuth as unknown as ReturnType<typeof vi.fn>;
const getAuthenticatedGuardianMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;
const enforceActorRateLimitMock = enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;

function req(url = "http://localhost/api/mobile/features") {
  return new Request(url, { headers: { Authorization: "Bearer token" } }) as unknown as Parameters<typeof featuresGet>[0];
}

// Per-school overrides — anything not listed here defaults to enabled=true
// (getSchoolFeatureFlags' own documented "absence means enabled" rule).
const OVERRIDES: Record<string, { key: string; enabled: boolean }[]> = {
  "school-a": [{ key: "FEES", enabled: false }],
  "school-b": [{ key: "FEES", enabled: true }, { key: "NOTEBOOK_CHECKING", enabled: false }],
};

beforeEach(() => {
  vi.clearAllMocks();
  enforceActorRateLimitMock.mockResolvedValue(null);
  p.schoolFeatureFlag.findMany.mockImplementation(async ({ where }: { where: { schoolId: string } }) => OVERRIDES[where.schoolId] ?? []);
});

describe("GET /api/mobile/features — unauthenticated", () => {
  it("denies a request with no valid mobile or parent session", async () => {
    getMobileAuthMock.mockResolvedValue(null);
    getAuthenticatedGuardianMock.mockResolvedValue(null);

    const res = await featuresGet(req());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/mobile/features — actor coverage", () => {
  it("Parent receives the current school's feature set", async () => {
    getMobileAuthMock.mockResolvedValue(null);
    getAuthenticatedGuardianMock.mockResolvedValue({ guardian: { id: "g1", schoolId: "school-a" } });

    const res = await featuresGet(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features.FEES).toBe(false); // overridden
    expect(body.features.ATTENDANCE).toBe(true); // default (no row)
    expect(body.features.HOMEWORK).toBe(true);
  });

  it("Student receives the current school's feature set", async () => {
    getMobileAuthMock.mockResolvedValue({
      decoded: { role: "STUDENT", schoolId: "school-a", studentId: "stu1" },
    });

    const res = await featuresGet(req());
    expect(res.status).toBe(200);
    expect((await res.json()).features.FEES).toBe(false);
  });

  it("Teacher receives the current school's feature set", async () => {
    getMobileAuthMock.mockResolvedValue({
      decoded: { role: "TEACHER", schoolId: "school-b", teacherId: "t1", userId: "u1" },
    });

    const res = await featuresGet(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features.FEES).toBe(true);
    expect(body.features.NOTEBOOK_CHECKING).toBe(false);
  });
});

describe("GET /api/mobile/features — tenant isolation", () => {
  it("School A cannot read School B's flags", async () => {
    getMobileAuthMock.mockResolvedValue({
      decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" },
    });

    const res = await featuresGet(req());
    const body = await res.json();
    expect(body.features.FEES).toBe(false); // school-a's override, not school-b's
    expect(p.schoolFeatureFlag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { schoolId: "school-a" } }));
  });

  it("a client-supplied schoolId query param is ignored — tenant comes only from the session", async () => {
    getMobileAuthMock.mockResolvedValue({
      decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" },
    });

    const res = await featuresGet(req("http://localhost/api/mobile/features?schoolId=school-b"));
    const body = await res.json();
    expect(body.features.FEES).toBe(false); // still school-a's data, not school-b's
    expect(p.schoolFeatureFlag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { schoolId: "school-a" } }));
  });
});

describe("GET /api/mobile/features — authorization boundary", () => {
  it("does not grant Teacher permission — response is a plain feature-flag map, not a permissions/scope grant", async () => {
    getMobileAuthMock.mockResolvedValue({
      decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" },
    });

    const res = await featuresGet(req());
    const body = await res.json();
    expect(body).toHaveProperty("features");
    expect(body).not.toHaveProperty("permissions");
    expect(body).not.toHaveProperty("scope");
    expect(body).not.toHaveProperty("hasCustomRole");
  });
});

describe("GET /api/mobile/features — lifecycle", () => {
  it("a blocked school's session is already rejected upstream by getMobileAuth/getAuthenticatedGuardian (this route adds no separate lifecycle check)", async () => {
    // getMobileAuth/getAuthenticatedGuardian themselves return null for a
    // suspended/expired school (see src/lib/mobile-auth.ts, src/lib/parent-auth.ts)
    // — the bootstrap route must not attempt to bypass or duplicate that.
    getMobileAuthMock.mockResolvedValue(null);
    getAuthenticatedGuardianMock.mockResolvedValue(null);

    const res = await featuresGet(req());
    expect(res.status).toBe(401);
    expect(p.schoolFeatureFlag.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/features — Cost Guard", () => {
  it("applies the STANDARD_READ classification and honors a rate-limit denial", async () => {
    getMobileAuthMock.mockResolvedValue({
      decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" },
    });
    enforceActorRateLimitMock.mockResolvedValueOnce(NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 }));

    const res = await featuresGet(req());
    expect(res.status).toBe(429);
    expect(enforceActorRateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-a" }), "STANDARD_READ");
    expect(p.schoolFeatureFlag.findMany).not.toHaveBeenCalled();
  });
});
