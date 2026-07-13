import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.NEXTAUTH_SECRET = "test-secret-for-proxy-gate-suite";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { proxy } from "@/proxy";

const getTokenMock = getToken as unknown as ReturnType<typeof vi.fn>;

function req(pathname: string) {
  return new NextRequest(new URL(pathname, "https://app.schoolsync.test"));
}

function locationPath(res: Response) {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("proxy() — Founder routes reject non-Founder sessions server-side", () => {
  it("redirects an unauthenticated request to /founder/login", async () => {
    getTokenMock.mockResolvedValue(null);
    const res = await proxy(req("/founder/dashboard"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(locationPath(res)).toBe("/founder/login");
  });

  it("redirects a valid but non-Founder session (e.g. SCHOOL_OWNER) away from /founder/*", async () => {
    getTokenMock.mockResolvedValue({ role: "SCHOOL_OWNER", schoolSlug: "school-one" });
    const res = await proxy(req("/founder/dashboard"));
    expect(locationPath(res)).toBe("/founder/login");
  });

  it("redirects a STUDENT session away from /founder/*", async () => {
    getTokenMock.mockResolvedValue({ role: "STUDENT" });
    const res = await proxy(req("/founder/schools"));
    expect(locationPath(res)).toBe("/founder/login");
  });

  it("lets a FOUNDER session through to /founder/*", async () => {
    getTokenMock.mockResolvedValue({ role: "FOUNDER" });
    const res = await proxy(req("/founder/dashboard"));
    // NextResponse.next() has no redirect Location header.
    expect(res.headers.get("location")).toBeNull();
  });

  it("returns a 403 JSON error (not an HTML redirect) for a non-Founder session hitting a Founder API route", async () => {
    getTokenMock.mockResolvedValue({ role: "TEACHER" });
    const res = await proxy(req("/api/founder/schools"));
    expect(res.status).toBe(403);
  });

  it("returns a 401 JSON error for an unauthenticated request to a Founder API route", async () => {
    getTokenMock.mockResolvedValue(null);
    const res = await proxy(req("/api/founder/schools"));
    expect(res.status).toBe(401);
  });

  it("redirects an authenticated FOUNDER away from the school-staff dashboard, not into it", async () => {
    getTokenMock.mockResolvedValue({ role: "FOUNDER" });
    const res = await proxy(req("/dashboard/school-one"));
    expect(locationPath(res)).toBe("/founder/dashboard");
  });
});

describe("proxy() — Student routes require a STUDENT session, independent of the Founder/staff gates", () => {
  it("redirects an unauthenticated request to /login (via /student/login forwarding)", async () => {
    getTokenMock.mockResolvedValue(null);
    const res = await proxy(req("/student/dashboard"));
    expect(locationPath(res)).toBe("/student/login");
  });

  it("redirects a non-Student session (e.g. TEACHER) away from /student/*", async () => {
    getTokenMock.mockResolvedValue({ role: "TEACHER" });
    const res = await proxy(req("/student/dashboard"));
    expect(locationPath(res)).toBe("/student/login");
  });

  it("lets a STUDENT session through to /student/*", async () => {
    getTokenMock.mockResolvedValue({ role: "STUDENT" });
    const res = await proxy(req("/student/dashboard"));
    expect(res.headers.get("location")).toBeNull();
  });
});
