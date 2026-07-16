import { describe, it, expect, vi } from "vitest";
import { nextApplicationNumber } from "@/lib/admissions/application-number";

function fakeTx(sequence: number[]) {
  let i = 0;
  return {
    $queryRaw: vi.fn(async () => {
      const lastValue = sequence[i++];
      return [{ lastValue }];
    }),
  } as unknown as import("@/generated/prisma/client").Prisma.TransactionClient;
}

describe("nextApplicationNumber — concurrency-safe per-school counter", () => {
  it("formats ADM-{year}-{6-digit sequence}", async () => {
    const tx = fakeTx([1]);
    const num = await nextApplicationNumber(tx, "sch1");
    expect(num).toMatch(/^ADM-\d{4}-000001$/);
  });

  it("never repeats a number across sequential calls simulating concurrent callers", async () => {
    // Simulates what the atomic INSERT ... ON CONFLICT DO UPDATE ... RETURNING
    // would produce for N serialized callers on the same school row — each
    // gets a strictly increasing, unique lastValue.
    const tx = fakeTx([1, 2, 3, 4, 5]);
    const numbers = await Promise.all(Array.from({ length: 5 }, () => nextApplicationNumber(tx, "sch1")));
    expect(new Set(numbers).size).toBe(5);
  });

  it("throws if the counter row returns no value", async () => {
    const tx = { $queryRaw: vi.fn(async () => []) } as unknown as import("@/generated/prisma/client").Prisma.TransactionClient;
    await expect(nextApplicationNumber(tx, "sch1")).rejects.toThrow();
  });
});
