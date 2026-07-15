import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/founder", () => ({ requireFounderSession: vi.fn() }));
vi.mock("@/lib/school-onboarding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/school-onboarding")>();
  return { ...actual, createSchoolWithAdmin: vi.fn() };
});
vi.mock("@/lib/job-handlers", () => ({ runInviteEmailDeliveryInline: vi.fn() }));
vi.mock("@/lib/founder-notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ getClientIp: vi.fn(() => "127.0.0.1") }));

import { requireFounderSession } from "@/lib/founder";
import { createSchoolWithAdmin } from "@/lib/school-onboarding";
import { runInviteEmailDeliveryInline } from "@/lib/job-handlers";
import { POST as addSchoolPost } from "@/app/api/founder/schools/route";

const founderSession = { user: { id: "founder1" } };

function jsonReq(method: string, body: unknown) {
  return new Request("http://localhost/api/x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/founder/schools (Add School)", () => {
  beforeEach(() => vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never));

  it("403s an unauthenticated caller and never calls createSchoolWithAdmin", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(null);
    const res = await addSchoolPost(jsonReq("POST", { idempotencyKey: "k".repeat(10), name: "XY", planId: "p1", adminName: "AB", adminEmail: "a@b.com" }));
    expect(res.status).toBe(403);
    expect(createSchoolWithAdmin).not.toHaveBeenCalled();
  });

  it("maps PLAN_NOT_FOUND / PLAN_INACTIVE to 404 without ever calling the email/notification/audit side effects", async () => {
    vi.mocked(createSchoolWithAdmin).mockResolvedValue({ ok: false, code: "PLAN_INACTIVE", error: "Selected plan is not active" });
    const res = await addSchoolPost(jsonReq("POST", { idempotencyKey: "k".repeat(10), name: "XY", planId: "p1", adminName: "AB", adminEmail: "a@b.com" }));
    expect(res.status).toBe(404);
    expect(runInviteEmailDeliveryInline).not.toHaveBeenCalled();
  });

  it("on success, attempts inline delivery of the durable job and returns the link", async () => {
    vi.mocked(createSchoolWithAdmin).mockResolvedValue({
      ok: true,
      deduplicated: false,
      school: { id: "school1", name: "X" } as never,
      invite: { id: "invite1", email: "a@b.com", name: "A" } as never,
      plan: { id: "plan1", name: "Basic" },
      deliveryJobId: "job1",
    });
    vi.mocked(runInviteEmailDeliveryInline).mockResolvedValue({ status: "COMPLETED", rawToken: "raw-token-abc" });

    const res = await addSchoolPost(jsonReq("POST", { idempotencyKey: "k".repeat(10), name: "XY", planId: "p1", adminName: "AB", adminEmail: "a@b.com" }));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.inviteLink).toContain("raw-token-abc");
    expect(json.emailError).toBeNull();
    expect(runInviteEmailDeliveryInline).toHaveBeenCalledWith("job1", expect.any(Request));
  });

  it("invitation failure is visible (emailError) but the request still succeeds — the durable job remains retryable", async () => {
    vi.mocked(createSchoolWithAdmin).mockResolvedValue({
      ok: true,
      deduplicated: false,
      school: { id: "school1", name: "X" } as never,
      invite: { id: "invite1", email: "a@b.com", name: "A" } as never,
      plan: { id: "plan1", name: "Basic" },
      deliveryJobId: "job1",
    });
    vi.mocked(runInviteEmailDeliveryInline).mockResolvedValue({ status: "FAILED", error: "SES down" });

    const res = await addSchoolPost(jsonReq("POST", { idempotencyKey: "k".repeat(10), name: "XY", planId: "p1", adminName: "AB", adminEmail: "a@b.com" }));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.emailError).toBeTruthy();
    expect(json.inviteLink).toBeNull();
  });

  it("a crash-recovered SKIPPED inline attempt (another runner already claimed the job) still succeeds, with no link to show yet", async () => {
    vi.mocked(createSchoolWithAdmin).mockResolvedValue({
      ok: true,
      deduplicated: false,
      school: { id: "school1", name: "X" } as never,
      invite: { id: "invite1", email: "a@b.com", name: "A" } as never,
      plan: { id: "plan1", name: "Basic" },
      deliveryJobId: "job1",
    });
    vi.mocked(runInviteEmailDeliveryInline).mockResolvedValue({ status: "SKIPPED" });

    const res = await addSchoolPost(jsonReq("POST", { idempotencyKey: "k".repeat(10), name: "XY", planId: "p1", adminName: "AB", adminEmail: "a@b.com" }));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.inviteLink).toBeNull();
    expect(json.emailError).toBeTruthy();
  });

  it("a deduplicated (retried) submit returns 200, not 201, and never attempts delivery again", async () => {
    vi.mocked(createSchoolWithAdmin).mockResolvedValue({
      ok: true,
      deduplicated: true,
      school: { id: "school1", name: "X" } as never,
      invite: { id: "invite1", email: "a@b.com" } as never,
      plan: { id: "plan1", name: "Basic" },
      deliveryJobId: null,
    });
    const res = await addSchoolPost(jsonReq("POST", { idempotencyKey: "k".repeat(10), name: "XY", planId: "p1", adminName: "AB", adminEmail: "a@b.com" }));
    expect(res.status).toBe(200);
    expect(runInviteEmailDeliveryInline).not.toHaveBeenCalled();
  });

  it("rejects a malformed body (missing idempotencyKey) with 400 before calling the domain layer", async () => {
    const res = await addSchoolPost(jsonReq("POST", { name: "XY", planId: "p1", adminName: "AB", adminEmail: "a@b.com" }));
    expect(res.status).toBe(400);
    expect(createSchoolWithAdmin).not.toHaveBeenCalled();
  });
});
