import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/founder", () => ({ requireFounderSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscriptionPlan: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ getClientIp: vi.fn(() => "127.0.0.1") }));

import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { GET, POST } from "@/app/api/founder/plans/route";
import { PATCH, DELETE } from "@/app/api/founder/plans/[planId]/route";

const p = prisma as unknown as {
  subscriptionPlan: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const founderSession = { user: { id: "founder1" } };

function req(body: unknown, url = "http://localhost/api/founder/plans") {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Founder-only server authorization", () => {
  it("GET rejects an unauthenticated/non-Founder caller with 403", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/founder/plans"));
    expect(res.status).toBe(403);
    expect(p.subscriptionPlan.findMany).not.toHaveBeenCalled();
  });

  it("POST rejects a non-Founder caller with 403 and never touches the database", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(null);
    const res = await POST(req({ name: "X", priceMonthly: 1, priceAnnual: 1 }));
    expect(res.status).toBe(403);
    expect(p.subscriptionPlan.create).not.toHaveBeenCalled();
  });

  it("PATCH and DELETE reject a non-Founder caller with 403", async () => {
    vi.mocked(requireFounderSession).mockResolvedValue(null);
    const patchRes = await PATCH(req({ name: "X" }), { params: Promise.resolve({ planId: "p1" }) });
    const deleteRes = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ planId: "p1" }) });
    expect(patchRes.status).toBe(403);
    expect(deleteRes.status).toBe(403);
    expect(p.subscriptionPlan.update).not.toHaveBeenCalled();
    expect(p.subscriptionPlan.delete).not.toHaveBeenCalled();
  });
});

describe("GET /api/founder/plans", () => {
  beforeEach(() => vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never));

  it("without activeOnly, returns every plan with school-usage counts and stable ordering", async () => {
    p.subscriptionPlan.findMany.mockResolvedValue([]);
    await GET(new Request("http://localhost/api/founder/plans"));
    expect(p.subscriptionPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { _count: { select: { subscriptions: true } } } })
    );
  });

  it("with activeOnly=true, filters to isActive plans only (the Add School / invite selector path)", async () => {
    p.subscriptionPlan.findMany.mockResolvedValue([]);
    await GET(new Request("http://localhost/api/founder/plans?activeOnly=true"));
    expect(p.subscriptionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });
});

describe("POST /api/founder/plans (create)", () => {
  beforeEach(() => vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never));

  it("creates a plan with integer-minor-unit prices derived from the decimal input", async () => {
    p.subscriptionPlan.create.mockResolvedValue({ id: "plan1", name: "Basic", slug: "basic" });
    const res = await POST(req({ name: "Basic", priceMonthly: 999, priceAnnual: 9999 }));
    expect(res.status).toBe(201);
    expect(p.subscriptionPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priceMonthlyMinor: 99900, priceAnnualMinor: 999900, slug: "basic" }) })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PLAN_CREATED" }));
  });

  it("rejects a negative price with 400 before touching the database", async () => {
    const res = await POST(req({ name: "Basic", priceMonthly: -5, priceAnnual: 0 }));
    expect(res.status).toBe(400);
    expect(p.subscriptionPlan.create).not.toHaveBeenCalled();
  });

  it("duplicate plan name/code (P2002) returns 409, not a raw 500", async () => {
    p.subscriptionPlan.create.mockRejectedValue(Object.assign(new Error("unique violation"), { code: "P2002" }));
    const res = await POST(req({ name: "Basic", priceMonthly: 1, priceAnnual: 1 }));
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/founder/plans/[planId] (edit / activate-deactivate)", () => {
  beforeEach(() => vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never));

  it("404s when the plan does not exist", async () => {
    p.subscriptionPlan.findUnique.mockResolvedValue(null);
    const res = await PATCH(req({ isActive: false }), { params: Promise.resolve({ planId: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("toggles isActive (deactivate) without requiring every other field", async () => {
    p.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan1", name: "Basic" });
    p.subscriptionPlan.update.mockResolvedValue({ id: "plan1", isActive: false });
    const res = await PATCH(req({ isActive: false }), { params: Promise.resolve({ planId: "plan1" }) });
    expect(res.status).toBe(200);
    expect(p.subscriptionPlan.update).toHaveBeenCalledWith({ where: { id: "plan1" }, data: { isActive: false } });
  });

  it("never accepts a slug/code change even if the client sends one (immutable plan code)", async () => {
    p.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan1", name: "Basic" });
    p.subscriptionPlan.update.mockResolvedValue({ id: "plan1" });
    await PATCH(req({ name: "Renamed", slug: "hacked" } as never), { params: Promise.resolve({ planId: "plan1" }) });
    const data = p.subscriptionPlan.update.mock.calls[0][0].data;
    expect(data.slug).toBeUndefined();
  });
});

describe("DELETE /api/founder/plans/[planId] (prevent destructive deletion when assigned)", () => {
  beforeEach(() => vi.mocked(requireFounderSession).mockResolvedValue(founderSession as never));

  it("409s and never deletes when the plan is assigned to a school", async () => {
    p.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan1", name: "Basic", _count: { subscriptions: 3 } });
    const res = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ planId: "plan1" }) });
    expect(res.status).toBe(409);
    expect(p.subscriptionPlan.delete).not.toHaveBeenCalled();
  });

  it("deletes a plan with zero assigned schools", async () => {
    p.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan1", name: "Basic", slug: "basic", _count: { subscriptions: 0 } });
    p.subscriptionPlan.delete.mockResolvedValue({ id: "plan1" });
    const res = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ planId: "plan1" }) });
    expect(res.status).toBe(200);
    expect(p.subscriptionPlan.delete).toHaveBeenCalledWith({ where: { id: "plan1" } });
  });

  it("a concurrent assignment landing between the count check and delete (P2003) returns 409, not 500", async () => {
    p.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan1", name: "Basic", slug: "basic", _count: { subscriptions: 0 } });
    p.subscriptionPlan.delete.mockRejectedValue(Object.assign(new Error("fk violation"), { code: "P2003" }));
    const res = await DELETE(new Request("http://localhost"), { params: Promise.resolve({ planId: "plan1" }) });
    expect(res.status).toBe(409);
  });
});
