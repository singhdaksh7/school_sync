/**
 * Expensive-job deduplication (PART 13). Prevents a duplicate equivalent
 * active job (same school + type + normalized payload) from being created
 * while one is already PENDING/RUNNING — a double-tap on "Generate" or a
 * retried request reuses the existing job instead of spawning another.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { JobType } from "@/generated/prisma/client";

/** Deterministic JSON serialization — object keys are sorted recursively so equivalent payloads with different key ordering fingerprint identically. Array element ORDER is preserved (arrays are semantically ordered here — e.g. batch section lists). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computePayloadFingerprint(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/** Finds an existing PENDING/RUNNING job with the exact same (school, type, fingerprint). A COMPLETED/FAILED job never blocks a new equivalent request. */
export async function findExistingEquivalentJob(schoolId: string, type: JobType, payload: unknown) {
  const fingerprint = computePayloadFingerprint(payload);
  const existing = await prisma.backgroundJob.findFirst({
    where: { schoolId, type, payloadFingerprint: fingerprint, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  return { fingerprint, existing };
}
