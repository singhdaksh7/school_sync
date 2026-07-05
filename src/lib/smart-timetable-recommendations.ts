/**
 * Smart Timetable — teacher recommendation engine (PART 8).
 */

import { prisma } from "@/lib/prisma";
import { isTeacherEligibleForSubject, buildSectionContext, getSectionDraftSlots } from "@/lib/smart-timetable-context";
import { resolveEffectiveWorkloadRule } from "@/lib/teacher-workload-rules";
import { computeCompatibleSlots } from "@/lib/smart-timetable-slots";
import { scoreTeacherRecommendation, type RecommendationLabel, type ScoreReason } from "@/lib/smart-timetable-scoring";

export interface TeacherRecommendation {
  teacherId: string;
  teacherName: string;
  score: number;
  rank: number;
  label: RecommendationLabel;
  workload: { current: number; maximum: number; remaining: number };
  minimumFreePeriods: number;
  currentFreePeriods: number;
  compatibleSlotCount: number;
  alreadyTeachesParallelSection: boolean;
  parallelSections: { sectionId: string; sectionName: string }[];
  reasons: ScoreReason[];
  warnings: ScoreReason[];
}

export async function recommendTeachers(args: {
  schoolId: string;
  classId: string;
  sectionId: string;
  subjectName: string;
  requiredPeriods: number;
  allowConsecutive: boolean;
  draftId?: string;
}): Promise<TeacherRecommendation[]> {
  const { schoolId, classId, sectionId, subjectName, requiredPeriods, allowConsecutive, draftId } = args;

  const [ctx, parallelSections, sectionSlots] = await Promise.all([
    buildSectionContext({ schoolId, sectionId, draftId }),
    prisma.section.findMany({ where: { classId, NOT: { id: sectionId } }, select: { id: true, name: true } }),
    getSectionDraftSlots(draftId),
  ]);

  const parallelSectionIds = parallelSections.map((s) => s.id);
  const parallelLiveSlots = parallelSectionIds.length
    ? await prisma.timetableSlot.findMany({
        where: { sectionId: { in: parallelSectionIds }, teacherId: { not: null } },
        select: { teacherId: true, sectionId: true, subject: true },
      })
    : [];

  const wanted = subjectName.trim().toLowerCase();
  const parallelTeachingByTeacher = new Map<string, Set<string>>();
  for (const s of parallelLiveSlots) {
    if (!s.teacherId || s.subject?.trim().toLowerCase() !== wanted) continue;
    if (!parallelTeachingByTeacher.has(s.teacherId)) parallelTeachingByTeacher.set(s.teacherId, new Set());
    parallelTeachingByTeacher.get(s.teacherId)!.add(s.sectionId);
  }

  const eligible = [...ctx.teachers.values()].filter((t) => isTeacherEligibleForSubject(t, subjectName));

  const recommendations = eligible.map((teacher) => {
    const rule = resolveEffectiveWorkloadRule(ctx.schoolDefaults, teacher.workloadOverride);
    const { valid } = computeCompatibleSlots({
      ctx,
      teacherId: teacher.id,
      sectionId,
      subjectName,
      allowConsecutive,
      sectionSlots,
      rule,
    });

    const parallelSectionIdsForTeacher = [...(parallelTeachingByTeacher.get(teacher.id) ?? [])];
    const alreadyTeachesParallelSection = parallelSectionIdsForTeacher.length > 0;

    const { score, label, reasons, warnings } = scoreTeacherRecommendation({
      ctx,
      teacherId: teacher.id,
      requiredPeriods,
      compatibleSlotCount: valid.length,
      rule,
      alreadyTeachesParallelSection,
    });

    const current = ctx.teacherOccupancy.get(teacher.id)?.size ?? 0;
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      score,
      label,
      workload: { current, maximum: rule.maxWeeklyTeachingPeriods, remaining: rule.maxWeeklyTeachingPeriods - current },
      minimumFreePeriods: rule.minFreeTeachingPeriods,
      currentFreePeriods: ctx.capacity - current,
      compatibleSlotCount: valid.length,
      alreadyTeachesParallelSection,
      parallelSections: parallelSections
        .filter((s) => parallelSectionIdsForTeacher.includes(s.id))
        .map((s) => ({ sectionId: s.id, sectionName: s.name })),
      reasons,
      warnings,
    };
  });

  recommendations.sort((a, b) => b.score - a.score || a.teacherId.localeCompare(b.teacherId));
  return recommendations.map((r, i) => ({ ...r, rank: i + 1 }));
}
