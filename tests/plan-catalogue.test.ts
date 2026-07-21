import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscriptionPlan: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  toMinorUnits,
  minorUnitsToDecimalString,
  createPlanSchema,
  updatePlanSchema,
  listActivePlans,
  applyPlanFeatureTemplate,
  SELECTABLE_PLAN_ORDER,
} from "@/lib/plan-catalogue";

describe("toMinorUnits / minorUnitsToDecimalString", () => {
  it("converts rupees to paise, rounding to the nearest integer", () => {
    expect(toMinorUnits(999)).toBe(99900);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits(19.995)).toBe(2000); // rounds, never truncates or leaves a float
  });

  it("rejects negative or non-finite amounts", () => {
    expect(() => toMinorUnits(-1)).toThrow();
    expect(() => toMinorUnits(Number.NaN)).toThrow();
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("round-trips minor units back to a 2-decimal string", () => {
    expect(minorUnitsToDecimalString(99900)).toBe("999.00");
    expect(minorUnitsToDecimalString(0)).toBe("0.00");
  });
});

describe("createPlanSchema / updatePlanSchema validation", () => {
  it("accepts a minimal valid create payload and defaults currency to INR", () => {
    const parsed = createPlanSchema.parse({ name: "Basic", priceMonthly: 999, priceAnnual: 9999 });
    expect(parsed.currency).toBe("INR");
    expect(parsed.enabledFeatures).toEqual([]); // defaults to an empty template when omitted
  });

  it("rejects negative prices", () => {
    expect(createPlanSchema.safeParse({ name: "X", priceMonthly: -1, priceAnnual: 0 }).success).toBe(false);
  });

  it("rejects a malformed currency code", () => {
    expect(createPlanSchema.safeParse({ name: "X", priceMonthly: 0, priceAnnual: 0, currency: "rupees" }).success).toBe(false);
  });

  it("rejects a non-integer or negative student/staff limit", () => {
    expect(createPlanSchema.safeParse({ name: "X", priceMonthly: 0, priceAnnual: 0, maxStudents: -5 }).success).toBe(false);
    expect(createPlanSchema.safeParse({ name: "X", priceMonthly: 0, priceAnnual: 0, staffLimit: 2.5 }).success).toBe(false);
  });

  it("allows null limits (unlimited)", () => {
    const parsed = createPlanSchema.parse({ name: "X", priceMonthly: 0, priceAnnual: 0, maxStudents: null, staffLimit: null });
    expect(parsed.maxStudents).toBeNull();
    expect(parsed.staffLimit).toBeNull();
  });

  it("de-duplicates enabledFeatures and rejects an unknown key", () => {
    const parsed = createPlanSchema.parse({ name: "X", priceMonthly: 0, priceAnnual: 0, enabledFeatures: ["FEES", "FEES", "HOMEWORK"] });
    expect(parsed.enabledFeatures).toEqual(["FEES", "HOMEWORK"]);
    expect(createPlanSchema.safeParse({ name: "X", priceMonthly: 0, priceAnnual: 0, enabledFeatures: ["NOT_A_REAL_FEATURE"] }).success).toBe(false);
  });

  it("updatePlanSchema silently strips a client-supplied slug — the plan code is immutable and never accepted from the client", () => {
    const parsed = updatePlanSchema.parse({ name: "Renamed", slug: "attacker-supplied" } as never);
    expect((parsed as Record<string, unknown>).slug).toBeUndefined();
  });
});

describe("listActivePlans", () => {
  it("queries only isActive plans with the stable (price, slug) ordering", async () => {
    const findMany = vi.mocked(prisma.subscriptionPlan.findMany);
    findMany.mockResolvedValue([]);
    await listActivePlans();
    expect(findMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: SELECTABLE_PLAN_ORDER });
  });
});

describe("applyPlanFeatureTemplate", () => {
  it("writes an explicit disabled row only for features the plan excludes (SchoolFeatureFlag is default-allow)", async () => {
    const createMany = vi.fn();
    const tx = { schoolFeatureFlag: { createMany } } as never;

    await applyPlanFeatureTemplate(tx, "school1", ["ATTENDANCE", "HOMEWORK"]);

    expect(createMany).toHaveBeenCalledTimes(1);
    const call = createMany.mock.calls[0][0];
    const keys = call.data.map((d: { key: string }) => d.key);
    expect(keys).not.toContain("ATTENDANCE");
    expect(keys).not.toContain("HOMEWORK");
    expect(keys).toContain("FEES");
    expect(call.data.every((d: { enabled: boolean }) => d.enabled === false)).toBe(true);
  });

  it("writes nothing when every feature is enabled (nothing to opt out of)", async () => {
    const createMany = vi.fn();
    const tx = { schoolFeatureFlag: { createMany } } as never;
    const { FEATURE_FLAG_KEYS } = await import("@/lib/feature-flag-constants");

    await applyPlanFeatureTemplate(tx, "school1", [...FEATURE_FLAG_KEYS]);

    expect(createMany).not.toHaveBeenCalled();
  });
});
