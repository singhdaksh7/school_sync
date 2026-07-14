import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn() },
    subscriptionPlan: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { createSchoolWithAdmin } from "@/lib/school-onboarding";

const p = prisma as unknown as {
  school: { findUnique: ReturnType<typeof vi.fn> };
  subscriptionPlan: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const validInput = {
  idempotencyKey: "idem-key-12345",
  name: "Greenwood High",
  planId: "plan1",
  adminName: "Jane Doe",
  adminEmail: "  Jane@School.EDU  ", // deliberately mixed-case/whitespace to test normalization
};

const activePlan = { id: "plan1", slug: "basic", isActive: true, priceMonthly: "999.00", enabledFeatures: ["FEES"] };

function makeTxClient() {
  const school = { id: "school1", name: "Greenwood High", slug: "greenwood-high" };
  const invite = { id: "invite1", email: "jane@school.edu", name: "Jane Doe", planId: "plan1" };
  const tx = {
    school: { create: vi.fn().mockResolvedValue(school) },
    schoolSubscription: { create: vi.fn().mockResolvedValue({}) },
    schoolFeatureFlag: { createMany: vi.fn().mockResolvedValue({}) },
    schoolInvite: { create: vi.fn().mockResolvedValue(invite) },
  };
  return { tx, school, invite };
}

beforeEach(() => vi.clearAllMocks());

describe("createSchoolWithAdmin — plan validation", () => {
  it("returns PLAN_NOT_FOUND when the plan doesn't exist, without opening a transaction", async () => {
    p.school.findUnique.mockResolvedValue(null);
    p.subscriptionPlan.findUnique.mockResolvedValue(null);
    const result = await createSchoolWithAdmin(validInput, "founder1");
    expect(result).toMatchObject({ ok: false, code: "PLAN_NOT_FOUND" });
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it("returns PLAN_INACTIVE when the plan exists but is deactivated", async () => {
    p.school.findUnique.mockResolvedValue(null);
    p.subscriptionPlan.findUnique.mockResolvedValue({ ...activePlan, isActive: false });
    const result = await createSchoolWithAdmin(validInput, "founder1");
    expect(result).toMatchObject({ ok: false, code: "PLAN_INACTIVE" });
    expect(p.$transaction).not.toHaveBeenCalled();
  });
});

describe("createSchoolWithAdmin — success path", () => {
  it("creates school + subscription + invite atomically and normalizes the admin email", async () => {
    p.school.findUnique.mockResolvedValueOnce(null); // idempotency-key lookup: no existing school
    p.school.findUnique.mockResolvedValueOnce(null); // slug-collision check: slug free
    p.subscriptionPlan.findUnique.mockResolvedValue(activePlan);
    const { tx, school, invite } = makeTxClient();
    p.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createSchoolWithAdmin(validInput, "founder1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.school).toEqual(school);
    expect(result.invite).toEqual(invite);
    expect(result.rawInviteToken).toBeTruthy();
    expect(result.deduplicated).toBe(false);

    expect(tx.schoolInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "jane@school.edu", role: "SCHOOL_ADMIN" }) })
    );
  });

  it("appends a slug suffix on collision rather than failing", async () => {
    p.school.findUnique.mockResolvedValueOnce(null); // idempotency lookup
    p.school.findUnique.mockResolvedValueOnce({ id: "existing" }); // slug already taken
    p.subscriptionPlan.findUnique.mockResolvedValue(activePlan);
    const { tx } = makeTxClient();
    p.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    await createSchoolWithAdmin(validInput, "founder1");

    const createCall = tx.school.create.mock.calls[0][0];
    expect(createCall.data.slug).not.toBe("greenwood-high");
    expect(createCall.data.slug).toMatch(/^greenwood-high-\d+$/);
  });
});

describe("createSchoolWithAdmin — idempotency", () => {
  it("a retried submit with the same idempotencyKey returns the original result without creating a new school", async () => {
    const existingSchool = {
      id: "school1",
      invites: [{ id: "invite1", email: "jane@school.edu", planId: "plan1" }],
    };
    p.school.findUnique.mockResolvedValue(existingSchool);
    p.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan1", name: "Basic" });

    const result = await createSchoolWithAdmin(validInput, "founder1");

    expect(result).toMatchObject({ ok: true, deduplicated: true, rawInviteToken: null });
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it("a concurrent double-submit that loses the DB unique-constraint race (P2002) is deduplicated, not failed", async () => {
    p.school.findUnique.mockResolvedValueOnce(null); // idempotency lookup: none yet (race window)
    p.school.findUnique.mockResolvedValueOnce(null); // slug check
    p.subscriptionPlan.findUnique.mockResolvedValue(activePlan);

    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    p.$transaction.mockRejectedValueOnce(p2002);
    // Post-failure requery finds the winner's row.
    p.school.findUnique.mockResolvedValueOnce({
      id: "school1",
      invites: [{ id: "invite1", email: "jane@school.edu", planId: "plan1" }],
    });

    const result = await createSchoolWithAdmin(validInput, "founder1");
    expect(result).toMatchObject({ ok: true, deduplicated: true });
  });

  it("a non-P2002 transaction failure propagates (never silently swallowed)", async () => {
    p.school.findUnique.mockResolvedValueOnce(null);
    p.school.findUnique.mockResolvedValueOnce(null);
    p.subscriptionPlan.findUnique.mockResolvedValue(activePlan);
    p.$transaction.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createSchoolWithAdmin(validInput, "founder1")).rejects.toThrow("connection lost");
  });
});
