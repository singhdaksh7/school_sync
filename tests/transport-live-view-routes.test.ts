import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/location-store", () => ({ readTripLocation: vi.fn() }));
vi.mock("@/lib/parent-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/parent-auth")>("@/lib/parent-auth");
  return { ...actual, getAuthenticatedGuardian: vi.fn() };
});
vi.mock("@/lib/mobile-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mobile-auth")>("@/lib/mobile-auth");
  return { ...actual, getTeacherAuth: vi.fn() };
});
vi.mock("@/lib/homework", () => ({ getTeacherAssignments: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    studentRouteAssignment: { findMany: vi.fn() },
    trip: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { getTeacherAssignments } from "@/lib/homework";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { readTripLocation } from "@/lib/location-store";

const p = prisma as unknown as {
  studentRouteAssignment: { findMany: ReturnType<typeof vi.fn> };
  trip: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};
const getGuardianMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;
const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const getTeacherAssignmentsMock = getTeacherAssignments as unknown as ReturnType<typeof vi.fn>;
const featureFlagMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const readLocationMock = readTripLocation as unknown as ReturnType<typeof vi.fn>;

function req(url: string, token = "x") {
  return new NextRequest(url, { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMock.mockResolvedValue(null);
  readLocationMock.mockResolvedValue({ ok: true, location: { lat: 1, lng: 2, updatedAt: "2026-07-21T00:00:00.000Z" } });
});

describe("GET /api/mobile/parent/transport/trip", () => {
  const GUARDIAN_AUTH = { decoded: { guardianId: "g1", schoolId: "school-a" }, guardian: { id: "g1", schoolId: "school-a" } };

  it("rejects when unauthenticated", async () => {
    getGuardianMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/mobile/parent/transport/trip/route");
    const res = await GET(req("http://localhost/api/mobile/parent/transport/trip"));
    expect(res.status).toBe(401);
  });

  it("rejects when TRANSPORT is disabled for the school", async () => {
    getGuardianMock.mockResolvedValue(GUARDIAN_AUTH);
    const { NextResponse } = await import("next/server");
    featureFlagMock.mockResolvedValue(NextResponse.json({ error: "off" }, { status: 403 }));
    const { GET } = await import("@/app/api/mobile/parent/transport/trip/route");
    const res = await GET(req("http://localhost/api/mobile/parent/transport/trip"));
    expect(res.status).toBe(403);
  });

  it("scopes the route lookup to this guardian's own children AND their own schoolId (cross-school/cross-family isolation)", async () => {
    getGuardianMock.mockResolvedValue(GUARDIAN_AUTH);
    p.studentRouteAssignment.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/parent/transport/trip/route");
    await GET(req("http://localhost/api/mobile/parent/transport/trip"));
    expect(p.studentRouteAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: "school-a",
          student: { guardianLinks: { some: { guardianId: "g1" } } },
        }),
      })
    );
  });

  it("returns an empty children list when none of the guardian's children are on any route", async () => {
    getGuardianMock.mockResolvedValue(GUARDIAN_AUTH);
    p.studentRouteAssignment.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/parent/transport/trip/route");
    const res = await GET(req("http://localhost/api/mobile/parent/transport/trip"));
    const body = await res.json();
    expect(body.children).toEqual([]);
  });

  it("includes coordinates while the trip is ACTIVE", async () => {
    getGuardianMock.mockResolvedValue(GUARDIAN_AUTH);
    p.studentRouteAssignment.findMany.mockResolvedValue([
      { studentId: "s1", student: { name: "Alice" }, routeId: "route-1", route: { id: "route-1", name: "North" }, stop: null },
    ]);
    p.trip.findFirst.mockResolvedValue({ id: "trip-1", status: "ACTIVE", startedAt: new Date(), endedAt: null });
    const { GET } = await import("@/app/api/mobile/parent/transport/trip/route");
    const res = await GET(req("http://localhost/api/mobile/parent/transport/trip"));
    const body = await res.json();
    expect(body.children[0].location).toEqual({ lat: 1, lng: 2, updatedAt: "2026-07-21T00:00:00.000Z" });
    expect(body.children[0].trip.status).toBe("ACTIVE");
  });

  it("NEVER returns coordinates once the trip has ended — trip-ended metadata only, no frozen last-known position", async () => {
    getGuardianMock.mockResolvedValue(GUARDIAN_AUTH);
    p.studentRouteAssignment.findMany.mockResolvedValue([
      { studentId: "s1", student: { name: "Alice" }, routeId: "route-1", route: { id: "route-1", name: "North" }, stop: null },
    ]);
    // No ACTIVE trip found (it already ended) — route only ever looks for status: "ACTIVE".
    p.trip.findFirst.mockResolvedValue(null);
    const { GET } = await import("@/app/api/mobile/parent/transport/trip/route");
    const res = await GET(req("http://localhost/api/mobile/parent/transport/trip"));
    const body = await res.json();
    expect(body.children[0].location).toBeNull();
    expect(body.children[0].trip.status).toBe("NO_ACTIVE_TRIP");
    expect(readLocationMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/teacher/transport/trips — section-scoped, not school-wide", () => {
  const TEACHER_AUTH = { userId: "u1", teacherId: "teacher-1", schoolId: "school-a" };

  it("rejects when unauthenticated", async () => {
    getTeacherAuthMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/mobile/teacher/transport/trips/route");
    const res = await GET(req("http://localhost/api/mobile/teacher/transport/trips"));
    expect(res.status).toBe(401);
  });

  it("returns no trips when the teacher teaches no sections carrying transport students", async () => {
    getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
    getTeacherAssignmentsMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/teacher/transport/trips/route");
    const res = await GET(req("http://localhost/api/mobile/teacher/transport/trips"));
    const body = await res.json();
    expect(body.trips).toEqual([]);
    expect(p.studentRouteAssignment.findMany).not.toHaveBeenCalled();
  });

  it("scopes the route lookup to sections the teacher actually teaches (not school-wide)", async () => {
    getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
    getTeacherAssignmentsMock.mockResolvedValue([{ sectionId: "sec-1", subject: "Math" }]);
    p.studentRouteAssignment.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/teacher/transport/trips/route");
    await GET(req("http://localhost/api/mobile/teacher/transport/trips"));
    expect(p.studentRouteAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-a", student: { sectionId: { in: ["sec-1"] } } } })
    );
  });

  it("a teacher with no students on any route sees no trips even if trips are active elsewhere in the school", async () => {
    getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
    getTeacherAssignmentsMock.mockResolvedValue([{ sectionId: "sec-1", subject: "Math" }]);
    p.studentRouteAssignment.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/teacher/transport/trips/route");
    const res = await GET(req("http://localhost/api/mobile/teacher/transport/trips"));
    const body = await res.json();
    expect(body.trips).toEqual([]);
    expect(p.trip.findMany).not.toHaveBeenCalled();
  });

  it("returns ACTIVE trips (with location) only for routes carrying the teacher's own students", async () => {
    getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
    getTeacherAssignmentsMock.mockResolvedValue([{ sectionId: "sec-1", subject: "Math" }]);
    p.studentRouteAssignment.findMany.mockResolvedValue([{ routeId: "route-1" }]);
    p.trip.findMany.mockResolvedValue([{ id: "trip-1", status: "ACTIVE", startedAt: new Date(), endedAt: null, route: { id: "route-1", name: "North" } }]);
    const { GET } = await import("@/app/api/mobile/teacher/transport/trips/route");
    const res = await GET(req("http://localhost/api/mobile/teacher/transport/trips"));
    expect(p.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-a", routeId: { in: ["route-1"] }, status: "ACTIVE" } })
    );
    const body = await res.json();
    expect(body.trips[0].location).toEqual({ lat: 1, lng: 2, updatedAt: "2026-07-21T00:00:00.000Z" });
  });
});
