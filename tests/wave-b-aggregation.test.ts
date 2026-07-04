import { describe, it, expect } from "vitest";
import { monthlyEquivalentPaise } from "@/lib/revenue";
import { paiseFromRupees } from "@/lib/money";

describe("founder revenue — Decimal-safe monthly equivalent", () => {
  it("keeps a MONTHLY subscription's amount unchanged", () => {
    expect(monthlyEquivalentPaise(paiseFromRupees(999), "MONTHLY")).toBe(99900);
  });

  it("divides an ANNUAL subscription by 12 in integer paise (no float drift)", () => {
    // 11988 / 12 = 999 exactly — the easy case.
    expect(monthlyEquivalentPaise(paiseFromRupees(11988), "ANNUAL")).toBe(99900);
  });

  it("rounds a non-evenly-divisible ANNUAL amount instead of truncating or drifting", () => {
    // 10000 rupees / 12 months = 833.333... rupees/month → 83333.33 paise → rounds to 83333.
    const paise = monthlyEquivalentPaise(paiseFromRupees(10000), "ANNUAL");
    expect(paise).toBe(83333);
  });

  it("summing many amounts in integer paise never drifts the way repeated float addition can", () => {
    // 0.1 + 0.2 !== 0.3 in float — the paise-integer path must not have this problem.
    const amounts = [0.1, 0.2, 0.3, 10.1, 99.99]; // true sum: 110.69
    const totalPaise = amounts.reduce((sum, a) => sum + monthlyEquivalentPaise(paiseFromRupees(a), "MONTHLY"), 0);
    expect(totalPaise).toBe(11069); // exact integer paise sum
    expect(totalPaise / 100).toBeCloseTo(110.69, 10);
  });
});
