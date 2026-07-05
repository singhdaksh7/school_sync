/**
 * School Operations Command Center — Operations Health (PART 21). Derived
 * entirely from the already-computed Needs Attention item list (operations-
 * attention.ts) rather than re-deriving its own thresholds — one severity
 * classification, reused. `score` is an OPTIONAL, documented, deterministic
 * informational number; `status` (not `score`) is the authoritative verdict.
 */

import type { AttentionItem, AttentionSeverity } from "@/lib/operations-attention";

export type OperationsHealthStatus = "HEALTHY" | "GOOD" | "NEEDS_ATTENTION" | "CRITICAL";

/** Points deducted from a 100 baseline per attention item of that severity. Named/documented, not scattered. */
const SEVERITY_SCORE_WEIGHT: Record<AttentionSeverity, number> = {
  CRITICAL: 40,
  HIGH: 20,
  MEDIUM: 8,
  LOW: 3,
};

export interface OperationsHealth {
  status: OperationsHealthStatus;
  /** 0-100, informational only — derived by deducting SEVERITY_SCORE_WEIGHT per attention item from a 100 baseline, floored at 0. */
  score: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

export function computeOperationsHealth(attentionItems: AttentionItem[]): OperationsHealth {
  const criticalCount = attentionItems.filter((i) => i.severity === "CRITICAL").length;
  const highCount = attentionItems.filter((i) => i.severity === "HIGH").length;
  const mediumCount = attentionItems.filter((i) => i.severity === "MEDIUM").length;
  const lowCount = attentionItems.filter((i) => i.severity === "LOW").length;

  let status: OperationsHealthStatus;
  if (criticalCount > 0) status = "CRITICAL";
  else if (highCount > 0) status = "NEEDS_ATTENTION";
  else if (mediumCount > 0) status = "GOOD";
  else status = "HEALTHY";

  const deduction =
    criticalCount * SEVERITY_SCORE_WEIGHT.CRITICAL +
    highCount * SEVERITY_SCORE_WEIGHT.HIGH +
    mediumCount * SEVERITY_SCORE_WEIGHT.MEDIUM +
    lowCount * SEVERITY_SCORE_WEIGHT.LOW;
  const score = Math.max(0, 100 - deduction);

  return { status, score, criticalCount, highCount, mediumCount, lowCount };
}
