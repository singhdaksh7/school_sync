import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/founder", () => ({ requireFounderSession: vi.fn() }));
vi.mock("@/lib/school-deletion", () => ({
  getSchoolDeletionImpact: vi.fn(),
  scheduleSchoolDeletion: vi.fn(),
  cancelSchoolDeletion: vi.fn(),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0 }) };
});

import { requireFounderSession } from "@/lib/founder";
import { scheduleSchoolDeletion, cancelSchoolDeletion, getSchoolDeletionImpact } from "@/lib/school-deletion";
import { rateLimit } from "@/lib/rate-limit";
import { GET as deletionGet, POST as deletionPost, DELETE as deletionDelete } from "@/app/api/founder/schools/[schoolId]/deletion/route";

const founderSession = { user: { id: "founder1" } };

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT a configured resolved value —
  // re-establish the default "allowed" outcome each test so a prior test's
  // rate-limit-exceeded mock never bleeds into an unrelated one.
  vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0 });
});

describe("Danger Zone deletion routes — Founder-only, re-auth, rate-limited", () => {
  const params = { params: Promise.resolve({ schoolId: "school1" }) };

  it("GET (impact preview) rejects a non-Founder caller", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(null);
    const res = await deletionGet(new Request("http://localhost"), params);
    expect(res.status).toBe(403);
    expect(getSchoolDeletionImpact).not.toHaveBeenCalled();
  });

  it("POST (schedule) is rate-limited and fails CLOSED on a limiter outage (destructive action)", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never);
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    const res = await deletionPost(jsonReq("POST", { password: "x", confirmedNameOrSlug: "y" }), params);
    expect(res.status).toBe(429);
    expect(scheduleSchoolDeletion).not.toHaveBeenCalled();
  });

  it("POST maps REAUTH_FAILED to 401 and CONFIRMATION_MISMATCH to 400", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never);
    vi.mocked(scheduleSchoolDeletion).mockResolvedValueOnce({ ok: false, code: "REAUTH_FAILED", error: "bad password" });
    const res1 = await deletionPost(jsonReq("POST", { password: "wrong", confirmedNameOrSlug: "y" }), params);
    expect(res1.status).toBe(401);

    vi.mocked(scheduleSchoolDeletion).mockResolvedValueOnce({ ok: false, code: "CONFIRMATION_MISMATCH", error: "mismatch" });
    const res2 = await deletionPost(jsonReq("POST", { password: "correct", confirmedNameOrSlug: "wrong-name" }), params);
    expect(res2.status).toBe(400);
  });

  it("POST 400s on a missing password/confirmation body before calling the domain layer", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never);
    const res = await deletionPost(jsonReq("POST", {}), params);
    expect(res.status).toBe(400);
    expect(scheduleSchoolDeletion).not.toHaveBeenCalled();
  });

  it("DELETE (cancel/restore) requires a password and maps INVALID_STATE (purge already claimed) to 409", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never);
    const badReq = await deletionDelete(jsonReq("DELETE", {}), params);
    expect(badReq.status).toBe(400);

    vi.mocked(cancelSchoolDeletion).mockResolvedValue({ ok: false, code: "INVALID_STATE", error: "already deleting" });
    const res = await deletionDelete(jsonReq("DELETE", { password: "correct" }), params);
    expect(res.status).toBe(409);
  });
});
