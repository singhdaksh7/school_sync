/**
 * Smart Timetable — deterministic quality score (PART 13).
 *
 * Never scores an invalid draft as publishable: an INVALID draft always gets
 * score: null, status: INVALID — hard conflicts are never hidden behind a
 * high soft score.
 */

import { prisma } from "@/lib/prisma";
import { getDraft, validateDraft, type DraftValidationIssue } from "@/lib/smart-timetable-drafts";
import { loadGenerationContext, normalizeSubjectName } from "@/lib/smart-timetable-context";
import { resolveEffectiveWorkloadRule } from "@/lib/teacher-workload-rules";
import type { Prisma } from "@/generated/prisma/client";

export interface QualityScoreComponents {
  subjectDistribution: number;
  teacherLoadBalance: number;
  freePeriodBalance: number;
  consecutiveLoad: number;
}

export interface QualityScoreWarning {
  code: string;
  message: string;
}

export interface QualityScoreResult {
  status: "VALID" | "INVALID";
  score: number | null;
  hardConstraintsSatisfied: boolean;
  components: QualityScoreComponents | null;
  warnings: QualityScoreWarning[];
}

function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Converts a non-negative "spread" measure into a 0-100 score (0 spread => 100). */
function spreadToScore(spread: number, scale: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - spread * scale)));
}

export async function computeQualityScore(draftId: string, schoolId: string): Promise<QualityScoreResult> {
  const validation = await validateDraft(draftId, schoolId);
  if (validation.status === "INVALID") {
    return {
      status: "INVALID",
      score: null,
      hardConstraintsSatisfied: false,
      components: null,
      warnings: validation.issues.map((i: DraftValidationIssue) => ({ code: i.code, message: i.message })),
    };
  }

  const draft = await getDraft(draftId, schoolId);
  if (!draft) {
    return { status: "INVALID", score: null, hardConstraintsSatisfied: false, components: null, warnings: [{ code: "DRAFT_NOT_FOUND", message: "Draft not found." }] };
  }

  const ctx = await loadGenerationContext({ schoolId, targetSectionIds: [draft.sectionId], batchDraftIds: [draftId] });
  const warnings: QualityScoreWarning[] = [];

  // S1 — subject distribution: for each subject with >1 period, penalize
  // uneven per-day placement (ideal = evenly spread across working days).
  const subjectDayCounts = new Map<string, Map<number, number>>();
  for (const slot of draft.slots) {
    if (!slot.subjectName) continue;
    const key = normalizeSubjectName(slot.subjectName);
    if (!subjectDayCounts.has(key)) subjectDayCounts.set(key, new Map());
    const dayMap = subjectDayCounts.get(key)!;
    dayMap.set(slot.dayOfWeek, (dayMap.get(slot.dayOfWeek) ?? 0) + 1);
  }
  let subjectSpreadTotal = 0;
  let subjectCount = 0;
  for (const [subjectName, dayMap] of subjectDayCounts) {
    const total = [...dayMap.values()].reduce((a, b) => a + b, 0);
    if (total <= 1) continue;
    const ideal = total / ctx.workingDays;
    const spread = [...dayMap.values()].reduce((sum, c) => sum + Math.abs(c - ideal), 0) / total;
    subjectSpreadTotal += spread;
    subjectCount++;
    if ([...dayMap.values()].some((c) => c >= 3)) {
      warnings.push({ code: "SUBJECT_CLUSTERED_ON_DAY", message: `${subjectName} is clustered heavily on a single day.` });
    }
  }
  const subjectDistribution = subjectCount > 0 ? spreadToScore(subjectSpreadTotal / subjectCount, 40) : 100;

  // Teacher-level stats (load balance, free-period balance, consecutive load).
  const teacherIds = new Set(draft.slots.map((s) => s.teacherId).filter((id): id is string => Boolean(id)));
  const loadRatios: number[] = [];
  const freeDaySpreads: number[] = [];
  const consecutiveExcess: number[] = [];
  let finalPeriodClusterCount = 0;

  for (const teacherId of teacherIds) {
    const teacher = ctx.teachers.get(teacherId);
    if (!teacher) continue;
    const weekly = ctx.teacherOccupancy.get(teacherId)?.size ?? 0;
    const rule = resolveEffectiveWorkloadRule(ctx.schoolDefaults, teacher.workloadOverride);
    loadRatios.push(rule.maxWeeklyTeachingPeriods > 0 ? weekly / rule.maxWeeklyTeachingPeriods : 0);

    const perDay: number[] = [];
    for (let day = 1; day <= ctx.workingDays; day++) {
      const dayPeriods = [...(ctx.teacherOccupancy.get(teacherId) ?? [])].filter((k) => Number(k.split("-")[0]) === day).length;
      perDay.push(ctx.periodsPerDay - dayPeriods);
    }
    freeDaySpreads.push(stdev(perDay));

    for (let day = 1; day <= ctx.workingDays; day++) {
      const periods = [...(ctx.teacherOccupancy.get(teacherId) ?? [])]
        .filter((k) => Number(k.split("-")[0]) === day)
        .map((k) => Number(k.split("-")[1]))
        .sort((a, b) => a - b);
      let longest = 0;
      let current = 0;
      let prev: number | null = null;
      for (const p of periods) {
        current = prev !== null && p === prev + 1 ? current + 1 : 1;
        longest = Math.max(longest, current);
        prev = p;
      }
      if (longest > 1) consecutiveExcess.push(longest - 1);
      if (periods.includes(ctx.periodsPerDay)) finalPeriodClusterCount++;
    }
  }

  const teacherLoadBalance = spreadToScore(stdev(loadRatios), 100);
  const freePeriodBalance = spreadToScore(freeDaySpreads.reduce((a, b) => a + b, 0) / Math.max(1, freeDaySpreads.length), 30);
  const avgConsecutiveExcess = consecutiveExcess.length > 0 ? consecutiveExcess.reduce((a, b) => a + b, 0) / consecutiveExcess.length : 0;
  const consecutiveLoad = spreadToScore(avgConsecutiveExcess, 25);

  if (finalPeriodClusterCount >= 2) {
    warnings.push({ code: "SUBJECT_LATE_PERIOD_CLUSTER", message: "Multiple subjects occur in the final period of the day." });
  }

  const components: QualityScoreComponents = { subjectDistribution, teacherLoadBalance, freePeriodBalance, consecutiveLoad };
  const score = Math.round((components.subjectDistribution + components.teacherLoadBalance + components.freePeriodBalance + components.consecutiveLoad) / 4);

  await prisma.timetableDraft.update({
    where: { id: draftId },
    data: { qualityScore: score, diagnostics: { issues: [], components, warnings } as unknown as Prisma.InputJsonValue },
  });

  return { status: "VALID", score, hardConstraintsSatisfied: true, components, warnings };
}
