import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPublicRoute, isFounderRoute, isStudentRoute } from "@/proxy";

// Regression for the worker/maintenance HTML-instead-of-JSON bug: proxy.ts
// gates non-public paths behind a NextAuth session cookie via getToken().
// Both routes under /api/internal/ authenticate via a timing-safe
// comparison against JOB_WORKER_SECRET (an x-worker-secret header) — never
// a session cookie — so a cookie-only gate 307-redirected every internal
// caller (scripts/worker.ts, a maintenance scheduler) to /login, and
// `fetch()` following that redirect handed back the login PAGE's HTML,
// which a JSON-expecting caller then fails to parse. Same bypass pattern
// already used for /api/teacher/ and /api/student/ in proxy.ts.
describe("proxy isPublicRoute — /api/internal/ bypasses the cookie gate", () => {
  const internalRoutes = ["/api/internal/worker", "/api/internal/maintenance/file-retention"];

  it.each(internalRoutes)("%s bypasses the cookie gate", (pathname) => {
    expect(isPublicRoute(pathname)).toBe(true);
  });

  it("still gates unrelated non-public paths (no over-broad bypass)", () => {
    expect(isPublicRoute("/dashboard")).toBe(false);
    expect(isPublicRoute("/founder")).toBe(false);
    expect(isPublicRoute("/student")).toBe(false);
    expect(isPublicRoute("/api/schools/school-a/teachers")).toBe(false);
  });

  it("founder/student route boundaries are unchanged by this bypass", () => {
    expect(isFounderRoute("/founder/dashboard")).toBe(true);
    expect(isFounderRoute("/founder/login")).toBe(false);
    expect(isStudentRoute("/student/dashboard")).toBe(true);
    expect(isStudentRoute("/student/login")).toBe(false);
    // Internal routes are not founder or student routes.
    expect(isFounderRoute("/api/internal/worker")).toBe(false);
    expect(isStudentRoute("/api/internal/worker")).toBe(false);
  });

  it("existing bypasses (teacher/student/mobile/health) are unaffected", () => {
    expect(isPublicRoute("/api/teacher/me")).toBe(true);
    expect(isPublicRoute("/api/student/attendance")).toBe(true);
    expect(isPublicRoute("/api/mobile/me")).toBe(true);
    expect(isPublicRoute("/api/health")).toBe(true);
  });
});

// End-to-end proof (independent of the proxy layer) that a request with no
// NextAuth session reaches the internal route handler and gets back
// structured JSON — never the HTML login page.
describe("unauthenticated /api/internal requests reach the handler and get JSON, not HTML", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.JOB_WORKER_SECRET = "test-only-worker-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("POST /api/internal/worker with a missing worker-secret header returns JSON 401 (not a redirect)", async () => {
    const { POST } = await import("@/app/api/internal/worker/route");
    const res = await POST(new Request("http://localhost/api/internal/worker", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("POST /api/internal/worker with an incorrect worker-secret header returns JSON 401 (not a redirect)", async () => {
    const { POST } = await import("@/app/api/internal/worker/route");
    const res = await POST(
      new Request("http://localhost/api/internal/worker", {
        method: "POST",
        headers: { "x-worker-secret": "definitely-the-wrong-secret" },
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("POST /api/internal/worker with the correct secret is handled by the route (reaches processJobs)", async () => {
    vi.doMock("@/lib/job-processor", () => ({ processJobs: vi.fn(async () => ({ processed: 3 })) }));
    const { POST } = await import("@/app/api/internal/worker/route");
    const res = await POST(
      new Request("http://localhost/api/internal/worker", {
        method: "POST",
        headers: { "x-worker-secret": "test-only-worker-secret-do-not-use-in-prod" },
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ processed: 3 });
  });

  it("POST /api/internal/maintenance/file-retention with a missing secret returns JSON 401 (not a redirect)", async () => {
    const { POST } = await import("@/app/api/internal/maintenance/file-retention/route");
    const res = await POST(new Request("http://localhost/api/internal/maintenance/file-retention", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("POST /api/internal/maintenance/file-retention with the correct secret is handled by the route", async () => {
    vi.doMock("@/lib/file-retention", () => ({
      ensureFileRetentionCleanupJob: vi.fn(async () => ({ jobId: "job_test123", created: true })),
    }));
    const { POST } = await import("@/app/api/internal/maintenance/file-retention/route");
    const res = await POST(
      new Request("http://localhost/api/internal/maintenance/file-retention", {
        method: "POST",
        headers: { "x-worker-secret": "test-only-worker-secret-do-not-use-in-prod" },
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ jobId: "job_test123", created: true });
  });
});

// Confirms other protected application routes still redirect unauthenticated
// users at the proxy layer — this fix must not weaken the general gate.
describe("other protected routes still gate behind the cookie (unaffected by the /api/internal bypass)", () => {
  it("web dashboard/teacher/founder/student pages remain non-public", () => {
    expect(isPublicRoute("/dashboard/some-school")).toBe(false);
    expect(isPublicRoute("/teacher/attendance")).toBe(false);
    expect(isPublicRoute("/founder/dashboard")).toBe(false);
    expect(isPublicRoute("/student/dashboard")).toBe(false);
  });
});
