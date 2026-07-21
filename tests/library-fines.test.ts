import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { overdueDays, isOverdue, computeFine } from "@/lib/library/fines";

const TZ = "Asia/Kolkata";

function d(iso: string) {
  return new Date(iso);
}

describe("overdueDays (school-timezone, whole calendar days)", () => {
  it("returns 0 when returned on the due date", () => {
    expect(overdueDays(d("2026-07-10T04:00:00Z"), d("2026-07-10T10:00:00Z"), TZ)).toBe(0);
  });

  it("returns 0 when returned before the due date", () => {
    expect(overdueDays(d("2026-07-10T04:00:00Z"), d("2026-07-05T10:00:00Z"), TZ)).toBe(0);
  });

  it("counts each calendar day past due", () => {
    expect(overdueDays(d("2026-07-10T00:00:00Z"), d("2026-07-13T00:00:00Z"), TZ)).toBe(3);
  });

  it("uses the school timezone for the day boundary (IST is UTC+5:30)", () => {
    // Due 2026-07-10 (IST), reference just after IST midnight on the 11th.
    const due = d("2026-07-10T06:00:00Z"); // 11:30 IST on the 10th
    const ref = d("2026-07-10T19:00:00Z"); // 00:30 IST on the 11th
    expect(overdueDays(due, ref, TZ)).toBe(1);
  });
});

describe("isOverdue", () => {
  it("is true only when past due", () => {
    expect(isOverdue(d("2026-07-10T00:00:00Z"), d("2026-07-11T00:00:00Z"), TZ)).toBe(true);
    expect(isOverdue(d("2026-07-10T00:00:00Z"), d("2026-07-10T00:00:00Z"), TZ)).toBe(false);
  });
});

describe("computeFine (deterministic Decimal, grace days applied)", () => {
  const policy = { finePerOverdueDay: new Prisma.Decimal("2.00"), graceDays: 1 };

  it("is exactly zero within grace period", () => {
    // 1 day overdue, 1 grace day => chargeable 0.
    const fine = computeFine(d("2026-07-10T00:00:00Z"), d("2026-07-11T00:00:00Z"), TZ, policy);
    expect(fine.toFixed(2)).toBe("0.00");
  });

  it("charges (overdue - grace) * rate", () => {
    // 5 days overdue, 1 grace => 4 chargeable * 2.00 = 8.00
    const fine = computeFine(d("2026-07-10T00:00:00Z"), d("2026-07-15T00:00:00Z"), TZ, policy);
    expect(fine.toFixed(2)).toBe("8.00");
  });

  it("uses exact Decimal arithmetic (no float drift)", () => {
    const p2 = { finePerOverdueDay: new Prisma.Decimal("2.50"), graceDays: 0 };
    const fine = computeFine(d("2026-07-10T00:00:00Z"), d("2026-07-13T00:00:00Z"), TZ, p2);
    expect(fine.toFixed(2)).toBe("7.50");
    expect(fine instanceof Prisma.Decimal).toBe(true);
  });

  it("never returns a negative fine when not overdue", () => {
    const fine = computeFine(d("2026-07-10T00:00:00Z"), d("2026-07-01T00:00:00Z"), TZ, policy);
    expect(fine.toFixed(2)).toBe("0.00");
  });
});
