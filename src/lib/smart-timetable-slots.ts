/**
 * Smart Timetable — compatible slot engine (PART 9). Shared core used both by
 * the dedicated slot-recommendation endpoint and the teacher recommendation
 * engine's compatible-slot counting.
 */

import { resolveEffectiveWorkloadRule, type EffectiveWorkloadRule } from "@/lib/teacher-workload-rules";
import { buildSectionContext, getSectionDraftSlots, type GenerationContext } from "@/lib/smart-timetable-context";
import { checkHardConstraints, type AssignmentCandidate, type ConstraintViolation } from "@/lib/smart-timetable-constraints";
import { scoreSlotCandidate, type ScoreReason } from "@/lib/smart-timetable-scoring";

export interface SlotRecommendation {
  day: number;
  period: number;
  score: number;
  reasons: ScoreReason[];
  warnings: ScoreReason[];
}

export interface SlotDiagnostic extends SlotRecommendation {
  valid: boolean;
  violations: ConstraintViolation[];
}

export interface ComputeCompatibleSlotsArgs {
  ctx: GenerationContext;
  teacherId: string;
  sectionId: string;
  subjectName: string;
  allowConsecutive: boolean;
  /** This section's OWN existing draft slots (for spread/consecutive scoring). */
  sectionSlots: { day: number; period: number; subjectName: string | null }[];
  rule: EffectiveWorkloadRule;
  /** When true, also returns every rejected slot with its violations (diagnostic mode). */
  includeInvalid?: boolean;
}

/**
 * Returns every timetable-compatible (day, period) for a candidate
 * teacher/section/subject assignment, ranked by deterministic soft score
 * (highest first, tie-broken by day then period). Invalid slots are excluded
 * from the ranked result unless `includeInvalid` is set (diagnostic mode).
 */
export function computeCompatibleSlots(args: ComputeCompatibleSlotsArgs): {
  valid: SlotRecommendation[];
  diagnostics?: SlotDiagnostic[];
} {
  const { ctx, teacherId, sectionId, subjectName, allowConsecutive, sectionSlots, rule, includeInvalid } = args;
  const results: SlotDiagnostic[] = [];

  for (let day = 1; day <= ctx.workingDays; day++) {
    for (let period = 1; period <= ctx.periodsPerDay; period++) {
      const candidate: AssignmentCandidate = { teacherId, sectionId, day, period, subjectName };
      const violations = checkHardConstraints(ctx, candidate, rule);
      const valid = violations.every((v) => v.severity !== "ERROR");

      let score = 0;
      let reasons: ScoreReason[] = [];
      let warnings: ScoreReason[] = [];
      if (valid) {
        const breakdown = scoreSlotCandidate({ ctx, teacherId, subjectName, day, period, sectionSlots, allowConsecutive, rule });
        score = breakdown.score;
        reasons = breakdown.reasons;
        warnings = breakdown.warnings;
      }
      results.push({ day, period, score, reasons, warnings, valid, violations });
    }
  }

  const validSorted = results
    .filter((r) => r.valid)
    .sort((a, b) => b.score - a.score || a.day - b.day || a.period - b.period);

  return {
    valid: validSorted.map(({ day, period, score, reasons, warnings }) => ({ day, period, score, reasons, warnings })),
    diagnostics: includeInvalid ? results : undefined,
  };
}

/** DB-aware wrapper: loads the section's generation context + draft slots, then computes compatible slots for one teacher/subject candidate. */
export async function getCompatibleSlotsForAssignment(args: {
  schoolId: string;
  sectionId: string;
  teacherId: string;
  subjectName: string;
  allowConsecutive: boolean;
  draftId?: string;
  includeInvalid?: boolean;
}): Promise<{ valid: SlotRecommendation[]; diagnostics?: SlotDiagnostic[] }> {
  const { schoolId, sectionId, teacherId, subjectName, allowConsecutive, draftId, includeInvalid } = args;
  const [ctx, sectionSlots] = await Promise.all([
    buildSectionContext({ schoolId, sectionId, draftId }),
    getSectionDraftSlots(draftId),
  ]);
  const teacher = ctx.teachers.get(teacherId);
  const rule = resolveEffectiveWorkloadRule(ctx.schoolDefaults, teacher?.workloadOverride ?? null);
  return computeCompatibleSlots({ ctx, teacherId, sectionId, subjectName, allowConsecutive, sectionSlots, rule, includeInvalid });
}
