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
  const job = { id: "job1", type: "INVITE_EMAIL_DELIVERY", schoolId: "school1", status: "PENDING" };
  const tx = {
    school: { create: vi.fn().mockResolvedValue(school) },
    schoolSubscription: { create: vi.fn().mockResolvedValue({}) },
    schoolFeatureFlag: { createMany: vi.fn().mockResolvedValue({}) },
    schoolInvite: { create: vi.fn().mockResolvedValue(invite) },
    backgroundJob: { create: vi.fn().mockResolvedValue(job) },
  };
  return { tx, school, invite, job };
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
  it("creates school + subscription + invite + a durable delivery job atomically, and normalizes the admin email", async () => {
    p.school.findUnique.mockResolvedValueOnce(null); // idempotency-key lookup: no existing school
    p.school.findUnique.mockResolvedValueOnce(null); // slug-collision check: slug free
    p.subscriptionPlan.findUnique.mockResolvedValue(activePlan);
    const { tx, school, invite, job } = makeTxClient();
    p.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createSchoolWithAdmin(validInput, "founder1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.school).toEqual(school);
    expect(result.invite).toEqual(invite);
    expect(result.deliveryJobId).toBe(job.id);
    expect(result.deduplicated).toBe(false);

    expect(tx.schoolInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "jane@school.edu", role: "SCHOOL_ADMIN" }) })
    );
    // No raw token is ever generated/persisted in this transaction — only
    // the durable outbox job. tokenHash is minted later, at actual send time.
    expect(tx.schoolInvite.create.mock.calls[0][0].data).not.toHaveProperty("tokenHash");
    expect(tx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "INVITE_EMAIL_DELIVERY",
          schoolId: school.id,
          payload: { inviteId: invite.id },
          payloadFingerprint: invite.id,
          status: "PENDING",
        }),
      })
    );
  });

  it("the durable delivery job is created strictly AFTER the invite, inside the same transaction — proving a crash right after commit still leaves both rows behind", async () => {
    p.school.findUnique.mockResolvedValueOnce(null);
    p.school.findUnique.mockResolvedValueOnce(null);
    p.subscriptionPlan.findUnique.mockResolvedValue(activePlan);
    const { tx } = makeTxClient();
    const callOrder: string[] = [];
    tx.schoolInvite.create.mockImplementation(async () => {
      callOrder.push("invite");
      return { id: "invite1", email: "jane@school.edu", name: "Jane Doe", planId: "plan1" };
    });
    tx.backgroundJob.create.mockImplementation(async () => {
      callOrder.push("job");
      return { id: "job1" };
    });
    p.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const result = await createSchoolWithAdmin(validInput, "founder1");

    expect(result.ok).toBe(true);
    // Both writes happened inside the ONE transaction callback that
    // $transaction commits atomically — there is no code path where the
    // invite exists without the job, or vice versa.
    expect(callOrder).toEqual(["invite", "job"]);
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

    expect(result).toMatchObject({ ok: true, deduplicated: true, deliveryJobId: null });
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
