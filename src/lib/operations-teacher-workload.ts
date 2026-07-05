/**
 * School Operations Command Center — today teacher workload insights (PART 13).
 * Reuses Smart Timetable's `resolveEffectiveWorkloadRule` (teacher-workload-
 * rules.ts) for max-daily/max-consecutive thresholds — never a duplicated
 * copy of that logic — and consumes the same `classifyTodayLectures` output
 * used by teacher-status/lecture-coverage rather than re-deriving effective
 * assignments a third time.
 */

import type { TodayOperationsContext } from "@/lib/operations-context";
import { classifyTodayLectures } from "@/lib/operations-lecture-coverage";
import { resolveEffectiveWorkloadRule } from "@/lib/teacher-workload-rules";

export type WorkloadClassification = "OVERLOADED" | "NORMAL" | "LIGHT_LOAD" | "NO_LECTURE";

/** A teacher with this many or fewer effective periods today is LIGHT_LOAD (not shaming — an operational scheduling signal, e.g. availability for coverage). */
export const LIGHT_LOAD_MAX_PERIODS = 2;

export interface TeacherWorkloadToday {
  teacherId: string;
  teacherName: string;
  scheduledPeriods: number;
  substitutionPeriods: number;
  effectivePeriods: number;
  freePeriods: number;
  longestConsecutiveRun: number;
  maxDailyTeachingPeriods: number;
  maxConsecutiveTeachingPeriods: number;
  classification: WorkloadClassification;
  warnings: string[];
}

function longestRun(periods: number[]): number {
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let prev: number | null = null;
  for (const p of sorted) {
    current = prev !== null && p === prev + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    prev = p;
  }
  return longest;
}

export function computeTeacherWorkloadToday(ctx: TodayOperationsContext): TeacherWorkloadToday[] {
  const allLectures = classifyTodayLectures(ctx);

  const effectivePeriodsByTeacher = new Map<string, number[]>();
  const scheduledByTeacher = new Map<string, number>();
  const substitutionByTeacher = new Map<string, number>();

  for (const lecture of allLectures) {
    if (lecture.originalTeacherId) {
      scheduledByTeacher.set(lecture.originalTeacherId, (scheduledByTeacher.get(lecture.originalTeacherId) ?? 0) + 1);
    }
    if (lecture.effectiveTeacherId) {
      const list = effectivePeriodsByTeacher.get(lecture.effectiveTeacherId) ?? [];
      list.push(lecture.period);
      effectivePeriodsByTeacher.set(lecture.effectiveTeacherId, list);
      if (lecture.status === "SUBSTITUTED" && lecture.effectiveTeacherId !== lecture.originalTeacherId) {
        substitutionByTeacher.set(lecture.effectiveTeacherId, (substitutionByTeacher.get(lecture.effectiveTeacherId) ?? 0) + 1);
      }
    }
  }

  const results: TeacherWorkloadToday[] = [];
  for (const [teacherId, teacher] of ctx.teachers) {
    const rule = resolveEffectiveWorkloadRule(ctx.workloadDefaults, ctx.teacherWorkloadOverrides.get(teacherId) ?? null);
    const effectivePeriodNumbers = effectivePeriodsByTeacher.get(teacherId) ?? [];
    const scheduledPeriods = scheduledByTeacher.get(teacherId) ?? 0;
    const substitutionPeriods = substitutionByTeacher.get(teacherId) ?? 0;
    const effectivePeriods = effectivePeriodNumbers.length;
    const freePeriods = Math.max(0, ctx.periodsPerDay - effectivePeriods);
    const longestConsecutiveRun = longestRun(effectivePeriodNumbers);

    const warnings: string[] = [];
    let classification: WorkloadClassification;
    if (effectivePeriods === 0) {
      classification = "NO_LECTURE";
    } else if (effectivePeriods > rule.maxDailyTeachingPeriods || longestConsecutiveRun > rule.maxConsecutiveTeachingPeriods) {
      classification = "OVERLOADED";
      if (effectivePeriods > rule.maxDailyTeachingPeriods) warnings.push("HIGH_DAILY_LOAD");
      if (longestConsecutiveRun > rule.maxConsecutiveTeachingPeriods) warnings.push("HIGH_CONSECUTIVE_LOAD");
    } else if (effectivePeriods <= LIGHT_LOAD_MAX_PERIODS) {
      classification = "LIGHT_LOAD";
    } else {
      classification = "NORMAL";
    }

    results.push({
      teacherId,
      teacherName: teacher.name,
      scheduledPeriods,
      substitutionPeriods,
      effectivePeriods,
      freePeriods,
      longestConsecutiveRun,
      maxDailyTeachingPeriods: rule.maxDailyTeachingPeriods,
      maxConsecutiveTeachingPeriods: rule.maxConsecutiveTeachingPeriods,
      classification,
      warnings,
    });
  }

  results.sort((a, b) => a.teacherName.localeCompare(b.teacherName) || a.teacherId.localeCompare(b.teacherId));
  return results;
}

export interface TeacherWorkloadSummary {
  overloaded: number;
  normal: number;
  lightLoad: number;
  noLecture: number;
}

export function summarizeTeacherWorkload(rows: TeacherWorkloadToday[]): TeacherWorkloadSummary {
  return {
    overloaded: rows.filter((r) => r.classification === "OVERLOADED").length,
    normal: rows.filter((r) => r.classification === "NORMAL").length,
    lightLoad: rows.filter((r) => r.classification === "LIGHT_LOAD").length,
    noLecture: rows.filter((r) => r.classification === "NO_LECTURE").length,
  };
}
