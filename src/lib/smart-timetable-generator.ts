/**
 * Smart Timetable — full automatic generator (PART 14, 15, 16).
 *
 * Deterministic strategy: most-constrained-subject-first ordering, greedy
 * best-slot placement per subject with bounded backtracking across candidate
 * teachers, no unbounded combinatorial search. Same input (same DB state +
 * same requirements + same locked slots) always produces the same draft —
 * verified by tests/wave-d-generator.test.ts calling the generator twice.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, TimetableDraftSource } from "@/generated/prisma/client";
import {
  loadGenerationContext,
  reserveSlot,
  isTeacherEligibleForSubject,
  normalizeSubjectName,
  type GenerationContext,
} from "@/lib/smart-timetable-context";
import { resolveEffectiveWorkloadRule } from "@/lib/teacher-workload-rules";
import { computeCompatibleSlots } from "@/lib/smart-timetable-slots";
import { scoreTeacherRecommendation } from "@/lib/smart-timetable-scoring";
import { validateDraft } from "@/lib/smart-timetable-drafts";
import { computeQualityScore } from "@/lib/smart-timetable-quality";

export type CompletionMode = "COMPLETE_REMAINING_ONLY" | "REOPTIMIZE_UNLOCKED";

export interface GenerationDiagnostic {
  code: string;
  subjectName?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateDraftArgs {
  schoolId: string;
  classId: string;
  sectionId: string;
  draftId?: string;
  completionMode?: CompletionMode;
  /** Other drafts in the same multi-section generation batch — see PART 17/18. */
  batchDraftIds?: string[];
  generationSeed?: string;
  createdById: string;
}

export interface GenerateDraftResult {
  draftId: string;
  outcome: "COMPLETE" | "PARTIAL";
  validationStatus: "VALID" | "INVALID";
  qualityScore: number | null;
  assignedCount: number;
  requiredCount: number;
  diagnostics: GenerationDiagnostic[];
}

interface PendingSlot {
  dayOfWeek: number;
  period: number;
  subjectName: string;
  teacherId: string;
  source: string;
  reasonCode: string;
}

function subjectDifficultyComparator(
  a: { eligibleCount: number; compatibleSlotTotal: number; remaining: number; subjectName: string },
  b: { eligibleCount: number; compatibleSlotTotal: number; remaining: number; subjectName: string }
): number {
  if (a.eligibleCount !== b.eligibleCount) return a.eligibleCount - b.eligibleCount; // fewer eligible teachers = more constrained = first
  if (a.compatibleSlotTotal !== b.compatibleSlotTotal) return a.compatibleSlotTotal - b.compatibleSlotTotal; // fewer compatible slots = first
  if (a.remaining !== b.remaining) return b.remaining - a.remaining; // higher remaining requirement = first
  return a.subjectName.localeCompare(b.subjectName); // deterministic tiebreak
}

/** Picks the best available eligible teacher for a subject at the CURRENT context state (occupancy already reflects earlier placements in this run). */
function rankCandidateTeachers(ctx: GenerationContext, subjectName: string, sectionId: string, requiredRemaining: number): string[] {
  const eligible = [...ctx.teachers.values()].filter((t) => isTeacherEligibleForSubject(t, subjectName));
  const scored = eligible.map((t) => {
    const rule = resolveEffectiveWorkloadRule(ctx.schoolDefaults, t.workloadOverride);
    const { valid } = computeCompatibleSlots({
      ctx,
      teacherId: t.id,
      sectionId,
      subjectName,
      allowConsecutive: false,
      sectionSlots: [],
      rule,
    });
    const { score } = scoreTeacherRecommendation({
      ctx,
      teacherId: t.id,
      requiredPeriods: requiredRemaining,
      compatibleSlotCount: valid.length,
      rule,
      alreadyTeachesParallelSection: false,
    });
    return { teacherId: t.id, score };
  });
  scored.sort((a, b) => b.score - a.score || a.teacherId.localeCompare(b.teacherId));
  return scored.map((s) => s.teacherId);
}

/**
 * Places up to `remaining` periods of one subject, trying candidate teachers
 * in ranked order (bounded backtracking: each teacher is tried until it has
 * no compatible slots left, then the next candidate is tried). Returns
 * placements + any diagnostic for periods that could not be placed.
 */
function placeSubject(
  ctx: GenerationContext,
  sectionId: string,
  subjectName: string,
  requirement: { requiredPeriodsPerWeek: number; allowConsecutive: boolean; preferredTeacherId: string | null },
  remaining: number,
  existingSectionSlots: { day: number; period: number; subjectName: string | null }[]
): { placements: PendingSlot[]; diagnostics: GenerationDiagnostic[] } {
  const placements: PendingSlot[] = [];
  const diagnostics: GenerationDiagnostic[] = [];
  const sectionSlots = [...existingSectionSlots];

  let candidates = rankCandidateTeachers(ctx, subjectName, sectionId, remaining);
  if (requirement.preferredTeacherId && candidates.includes(requirement.preferredTeacherId)) {
    candidates = [requirement.preferredTeacherId, ...candidates.filter((id) => id !== requirement.preferredTeacherId)];
  }

  if (candidates.length === 0) {
    diagnostics.push({
      code: "NO_ELIGIBLE_TEACHER",
      subjectName,
      message: `No eligible teacher found for ${subjectName}.`,
    });
    return { placements, diagnostics };
  }

  let left = remaining;
  const exhaustedTeachers: { teacherId: string; teacherName: string; reason: string }[] = [];

  for (const teacherId of candidates) {
    if (left <= 0) break;
    const teacher = ctx.teachers.get(teacherId)!;
    const rule = resolveEffectiveWorkloadRule(ctx.schoolDefaults, teacher.workloadOverride);

    while (left > 0) {
      const { valid } = computeCompatibleSlots({
        ctx,
        teacherId,
        sectionId,
        subjectName,
        allowConsecutive: requirement.allowConsecutive,
        sectionSlots,
        rule,
      });
      if (valid.length === 0) {
        const currentWeekly = ctx.teacherOccupancy.get(teacherId)?.size ?? 0;
        const capacityLeft = rule.maxWeeklyTeachingPeriods - currentWeekly;
        exhaustedTeachers.push({
          teacherId,
          teacherName: teacher.name,
          reason: capacityLeft <= 0 ? "maximum weekly workload reached" : "no remaining compatible slots",
        });
        break;
      }
      const best = valid[0];
      reserveSlot(ctx, teacherId, sectionId, best.day, best.period);
      sectionSlots.push({ day: best.day, period: best.period, subjectName });
      placements.push({
        dayOfWeek: best.day,
        period: best.period,
        subjectName,
        teacherId,
        source: "generated",
        reasonCode: best.reasons[0]?.code ?? "GENERATED",
      });
      left--;
    }
  }

  if (left > 0) {
    diagnostics.push({
      code: "MISSING_REQUIRED_SUBJECT_PERIODS",
      subjectName,
      message: `${subjectName}: required ${requirement.requiredPeriodsPerWeek}, placed ${remaining - left} of ${remaining} still-needed period(s).`,
      metadata: {
        required: requirement.requiredPeriodsPerWeek,
        missing: left,
        candidateTeachers: exhaustedTeachers,
        suggestions: [
          "Assign another eligible teacher for this subject.",
          "Increase a candidate teacher's maximum weekly workload.",
          "Reduce this subject's required weekly periods.",
          "Unlock a conflicting locked slot if one is blocking placement.",
        ],
      },
    });
  }

  return { placements, diagnostics };
}

export async function generateDraft(args: GenerateDraftArgs): Promise<GenerateDraftResult> {
  const { schoolId, classId, sectionId, completionMode = "COMPLETE_REMAINING_ONLY", batchDraftIds = [], generationSeed, createdById } = args;

  let draftId = args.draftId;
  if (!draftId) {
    const draft = await prisma.timetableDraft.create({
      data: { schoolId, classId, sectionId, createdById, source: "AUTO" as TimetableDraftSource, status: "DRAFT", generationSeed },
    });
    draftId = draft.id;
  } else if (completionMode === "REOPTIMIZE_UNLOCKED") {
    await prisma.timetableDraftSlot.deleteMany({ where: { draftId, locked: false } });
  }

  const requirements = await prisma.timetableSubjectRequirement.findMany({ where: { sectionId } });
  const existingSlots = await prisma.timetableDraftSlot.findMany({ where: { draftId } });

  const assignedPerSubject = new Map<string, number>();
  for (const s of existingSlots) {
    if (!s.subjectName) continue;
    const key = normalizeSubjectName(s.subjectName);
    assignedPerSubject.set(key, (assignedPerSubject.get(key) ?? 0) + 1);
  }

  const allBatchDraftIds = [...new Set([draftId, ...batchDraftIds])];
  const ctx = await loadGenerationContext({ schoolId, targetSectionIds: [sectionId], batchDraftIds: allBatchDraftIds });

  const sectionSlotsForScoring = existingSlots
    .filter((s) => s.subjectName)
    .map((s) => ({ day: s.dayOfWeek, period: s.period, subjectName: s.subjectName }));

  // PART 15 — most-constrained-first ordering.
  const withDifficulty = requirements.map((req) => {
    const alreadyAssigned = assignedPerSubject.get(normalizeSubjectName(req.subjectName)) ?? 0;
    const remaining = Math.max(0, req.requiredPeriodsPerWeek - alreadyAssigned);
    const eligible = [...ctx.teachers.values()].filter((t) => isTeacherEligibleForSubject(t, req.subjectName));
    let compatibleSlotTotal = 0;
    if (remaining > 0) {
      for (const t of eligible) {
        const rule = resolveEffectiveWorkloadRule(ctx.schoolDefaults, t.workloadOverride);
        const { valid } = computeCompatibleSlots({
          ctx,
          teacherId: t.id,
          sectionId,
          subjectName: req.subjectName,
          allowConsecutive: req.allowConsecutive,
          sectionSlots: sectionSlotsForScoring,
          rule,
        });
        compatibleSlotTotal += valid.length;
      }
    }
    return { req, remaining, eligibleCount: eligible.length, compatibleSlotTotal, subjectName: req.subjectName };
  });
  withDifficulty.sort(subjectDifficultyComparator);

  const allPlacements: PendingSlot[] = [];
  const diagnostics: GenerationDiagnostic[] = [];

  for (const item of withDifficulty) {
    if (item.remaining <= 0) continue;
    const { placements, diagnostics: subjectDiagnostics } = placeSubject(
      ctx,
      sectionId,
      item.req.subjectName,
      { requiredPeriodsPerWeek: item.req.requiredPeriodsPerWeek, allowConsecutive: item.req.allowConsecutive, preferredTeacherId: item.req.preferredTeacherId },
      item.remaining,
      sectionSlotsForScoring
    );
    allPlacements.push(...placements);
    diagnostics.push(...subjectDiagnostics);
    for (const p of placements) sectionSlotsForScoring.push({ day: p.dayOfWeek, period: p.period, subjectName: p.subjectName });
  }

  if (allPlacements.length > 0) {
    await prisma.$transaction(
      allPlacements.map((p) =>
        prisma.timetableDraftSlot.upsert({
          where: { draftId_dayOfWeek_period: { draftId: draftId!, dayOfWeek: p.dayOfWeek, period: p.period } },
          create: { draftId: draftId!, dayOfWeek: p.dayOfWeek, period: p.period, subjectName: p.subjectName, teacherId: p.teacherId, source: p.source, reasonCode: p.reasonCode },
          update: { subjectName: p.subjectName, teacherId: p.teacherId, source: p.source, reasonCode: p.reasonCode },
        })
      )
    );
  }

  const requiredTotal = requirements.reduce((sum, r) => sum + r.requiredPeriodsPerWeek, 0);
  const assignedTotal = requiredTotal - diagnostics.reduce((sum, d) => sum + (Number(d.metadata?.missing) || 0), 0);

  const validation = await validateDraft(draftId, schoolId);
  const quality = validation.status === "VALID" ? await computeQualityScore(draftId, schoolId) : null;

  await prisma.timetableDraft.update({
    where: { id: draftId },
    data: { diagnostics: { generation: diagnostics, validation: validation.issues } as unknown as Prisma.InputJsonValue },
  });

  return {
    draftId,
    outcome: diagnostics.length > 0 ? "PARTIAL" : "COMPLETE",
    validationStatus: validation.status,
    qualityScore: quality?.score ?? null,
    assignedCount: assignedTotal,
    requiredCount: requiredTotal,
    diagnostics,
  };
}
