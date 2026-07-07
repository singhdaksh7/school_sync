import { describe, it, expect, vi } from "vitest";
import { isPublicRoute } from "@/proxy";

// Regression for the "Teacher name loads, everything else is
// MALFORMED_RESPONSE" bug (and the matching Student issue): proxy.ts gates
// non-public paths behind a NextAuth session cookie via getToken(). Mobile
// Teacher/Student requests only ever carry a Bearer header, never that
// cookie, so any /api/teacher/* or /api/student/* route left out of
// isPublicRoute() got 307-redirected to the HTML /login page instead of
// reaching getTeacherAuth()/getStudentAuth()'s own Bearer-aware check. The
// proxy bypass is a TRANSPORT decision only — every route below still
// performs its own canonical auth and returns structured JSON, never HTML.
describe("proxy isPublicRoute — teacher mobile bearer routes bypass the cookie gate", () => {
  const teacherRoutes = [
    "/api/teacher/me",
    "/api/teacher/timetable",
    "/api/teacher/attendance/today",
    "/api/teacher/attendance/mark",
    "/api/teacher/homework",
    "/api/teacher/early-leave",
    "/api/teacher/leaves",
    "/api/teacher/arrangements",
    "/api/teacher/permissions",
    "/api/teacher/operational-roles/self-status",
  ];

  it.each(teacherRoutes)("%s bypasses the cookie gate like /api/mobile/*", (pathname) => {
    expect(isPublicRoute(pathname)).toBe(true);
  });

  it("still gates unrelated non-public paths (no over-broad bypass)", () => {
    expect(isPublicRoute("/dashboard")).toBe(false);
    expect(isPublicRoute("/teacher")).toBe(false);
    expect(isPublicRoute("/api/schools/school-a/teachers")).toBe(false);
  });

  it("existing mobile/parent bypasses are unaffected", () => {
    expect(isPublicRoute("/api/mobile/me")).toBe(true);
    expect(isPublicRoute("/api/parent/homework")).toBe(true);
  });
});

describe("proxy isPublicRoute — student mobile bearer routes bypass the cookie gate", () => {
  // Every /api/student/* route consumed by the unified mobile app, plus the
  // web-portal-only routes under the same prefix (dashboard, homework-summary,
  // notebook, profile) — all confirmed to use getStudentAuth() at the route
  // level, so the whole /api/student/ prefix is safe to bypass at the proxy.
  const studentRoutes = [
    "/api/student/attendance",
    "/api/student/homework",
    "/api/student/timetable",
    "/api/student/marks",
    "/api/student/report-cards",
    "/api/student/report-cards/some-id/pdf",
    "/api/student/announcements",
    "/api/student/leave",
    "/api/student/dashboard",
    "/api/student/homework-summary",
    "/api/student/notebook",
    "/api/student/profile",
  ];

  it.each(studentRoutes)("%s bypasses the cookie gate like /api/mobile/*", (pathname) => {
    expect(isPublicRoute(pathname)).toBe(true);
  });

  it("does not bypass the /student/* PAGE routes (web portal session gate is separate and unaffected)", () => {
    expect(isPublicRoute("/student")).toBe(false);
    expect(isPublicRoute("/student/dashboard")).toBe(false);
  });

  it("does not bypass unrelated protected web/API routes", () => {
    expect(isPublicRoute("/dashboard")).toBe(false);
    expect(isPublicRoute("/founder")).toBe(false);
    expect(isPublicRoute("/api/schools/school-a/students")).toBe(false);
  });
});

// End-to-end proof (independent of the proxy layer) that an unauthenticated
// Bearer/cookie-less request reaches the route handler and gets back
// structured JSON — never the HTML login page — for both roles.
describe("unauthenticated mobile requests reach the handler and get JSON, not HTML", () => {
  vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

  it("GET /api/teacher/me with no Authorization header and no session returns JSON 401 (not a redirect)", async () => {
    const { GET } = await import("@/app/api/teacher/me/route");
    const res = await GET(new Request("http://localhost/api/teacher/me"));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("GET /api/student/attendance with no Authorization header and no session returns JSON 401 (not a redirect)", async () => {
    const { GET } = await import("@/app/api/student/attendance/route");
    const res = await GET(new Request("http://localhost/api/student/attendance") as never);

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
