import { describe, it, expect } from "vitest";
import { extractActivityItems, formatActivityCode, type OperationsActivityItem } from "@/lib/operations-command-center-dto";

const item: OperationsActivityItem = {
  id: "log-1",
  code: "FEE_PAYMENT_RECORDED",
  entityType: "FeePayment",
  entityId: "fee-1",
  actorName: "Jane Doe",
  actorRole: "ADMIN",
  createdAt: "2026-07-06T04:00:00.000Z",
  metadata: null,
};

// Regression coverage for the Phase 5 runtime crash: GET
// .../operations/daily-summary's `activity` field is the real
// ActivityTimelinePage envelope `{ data: ActivityItem[]; total: number }`,
// not a bare array. Rendering it directly with `.map()`/`.length` (the
// pre-fix behavior) throws "activity.map is not a function" the instant the
// summary loads, because `{ data, total }` is a defined object — the
// `activity = []` destructuring default never applies.
describe("OperationsCommandCenter activity DTO boundary", () => {
  it("documents the crash: the raw ActivityTimelinePage envelope has no .map", () => {
    const rawEnvelope = { data: [item], total: 1 };
    expect(() => (rawEnvelope as unknown as Array<unknown>).map((x) => x)).toThrow(/map is not a function/);
  });

  it("unwraps the real { data, total } envelope into a plain array", () => {
    const result = extractActivityItems({ data: [item], total: 1 });
    expect(() => result.map((x) => x)).not.toThrow();
    expect(result).toEqual([item]);
  });

  it("returns an empty array for today's empty activity envelope", () => {
    expect(extractActivityItems({ data: [], total: 0 })).toEqual([]);
  });

  it("returns an empty array when the field is omitted (e.g. actor-redacted response)", () => {
    expect(extractActivityItems(undefined)).toEqual([]);
    expect(extractActivityItems(null)).toEqual([]);
  });

  it("passes through an already-bare array defensively", () => {
    expect(extractActivityItems([item])).toEqual([item]);
  });

  it("does not crash on an unexpected scalar shape", () => {
    expect(extractActivityItems(42)).toEqual([]);
    expect(extractActivityItems("oops")).toEqual([]);
  });

  it("formats an AuditAction code into a readable label", () => {
    expect(formatActivityCode("FEE_PAYMENT_RECORDED")).toBe("Fee Payment Recorded");
  });
});
