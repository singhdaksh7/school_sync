import type { Prisma } from "@/generated/prisma/client";

/**
 * Concurrency-safe, per-school application-number generator.
 *
 * Does NOT use count()+1 (classic TOCTOU race under concurrent creates).
 * Instead atomically increments a single AdmissionNumberCounter row per
 * school via `INSERT ... ON CONFLICT (schoolId) DO UPDATE SET lastValue =
 * "AdmissionNumberCounter"."lastValue" + 1 RETURNING "lastValue"` — the
 * DB-level unique constraint on schoolId (the PK) plus the atomic UPSERT
 * guarantees two concurrent callers for the same school always observe
 * different lastValue results, even without an app-level lock. Must be
 * called from inside the same transaction as the application INSERT so a
 * rolled-back application create doesn't "burn" a number silently forever
 * (a burned number is harmless — gaps are fine — but keeping them coupled
 * avoids the more confusing case of a counter that advanced while a
 * dependent create wholly failed to run at all).
 */
export async function nextApplicationNumber(
  tx: Prisma.TransactionClient,
  schoolId: string
): Promise<string> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "AdmissionNumberCounter" ("schoolId", "lastValue", "updatedAt")
    VALUES (${schoolId}, 1, now())
    ON CONFLICT ("schoolId")
    DO UPDATE SET "lastValue" = "AdmissionNumberCounter"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"
  `;
  const seq = rows[0]?.lastValue;
  if (!seq) throw new Error("Failed to allocate an application number");
  const year = new Date().getUTCFullYear();
  return `ADM-${year}-${String(seq).padStart(6, "0")}`;
}
