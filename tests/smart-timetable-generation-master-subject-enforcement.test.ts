import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves the Smart Timetable generation invariant: a legacy/unmapped
 * TimetableSubjectRequirement (subjectId: null, predating Master Subject
 * enforcement) remains readable/preserved but can never be auto-placed into
 * a new draft slot — only requirements canonically linked to a Master
 * Subject (subjectId set, itself only ever created through the validated
 * PUT /smart-timetable/requirements route) are eligible for placement.
 */

const { normalizeSubjectName, isTeacherEligibleForSubject, mathTeacher } = vi.hoisted(() => {
  function normalizeSubjectName(name: string): string {
    return name.trim().toLowerCase();
  }

  interface TeacherInfo {
    id: string;
    name: string;
    subject: string | null;
    eligibleSubjects: Set<string>;
    workloadOverride: unknown;
  }

  function isTeacherEligibleForSubject(teacher: TeacherInfo, subjectName: string): boolean {
    const wanted = normalizeSubjectName(subjectName);
    if (teacher.eligibleSubjects.size > 0) return teacher.eligibleSubjects.has(wanted);
    return teacher.subject ? normalizeSubjectName(teacher.subject) === wanted : false;
  }

  const mathTeacher: TeacherInfo = { id: "teacher-math", name: "Ms. Numeracy", subject: "Mathematics", eligibleSubjects: new Set(), workloadOverride: null };

  return { normalizeSubjectName, isTeacherEligibleForSubject, mathTeacher };
});

vi.mock("@/lib/smart-timetable-context", () => ({
  loadGenerationContext: vi.fn(async () => ({
    schoolId: "school-1",
    workingDays: 6,
    periodsPerDay: 6,
    capacity: 36,
    schoolDefaults: { timetableWorkingDays: 6, periodsPerDay: 6, defaultMaxWeeklyTeachingPeriods: null, defaultMinFreeTeachingPeriods: null, defaultMaxDailyTeachingPeriods: null, defaultMaxConsecutiveTeachingPeriods: null },
    teachers: new Map([[mathTeacher.id, mathTeacher]]),
    teacherOccupancy: new Map(),
    sectionOccupancy: new Map(),
  })),
  reserveSlot: vi.fn(),
  isTeacherEligibleForSubject,
  normalizeSubjectName,
}));

vi.mock("@/lib/teacher-workload-rules", () => ({
  resolveEffectiveWorkloadRule: vi.fn(() => ({ minFreeTeachingPeriods: 6, maxWeeklyTeachingPeriods: 30, maxDailyTeachingPeriods: 6, maxConsecutiveTeachingPeriods: 3 })),
}));

vi.mock("@/lib/smart-timetable-slots", () => ({
  computeCompatibleSlots: vi.fn(({ subjectName }: { subjectName: string }) => {
    if (normalizeSubjectName(subjectName) === "mathematics") {
      return { valid: [{ day: 1, period: 1, reasons: [{ code: "OK" }] }] };
    }
    return { valid: [] };
  }),
}));

vi.mock("@/lib/smart-timetable-scoring", () => ({
  scoreTeacherRecommendation: vi.fn(() => ({ score: 10 })),
  scoreSlotCandidate: vi.fn(() => ({ score: 10 })),
}));

vi.mock("@/lib/smart-timetable-drafts", () => ({
  validateDraft: vi.fn(async () => ({ status: "VALID", issues: [] })),
}));

vi.mock("@/lib/smart-timetable-quality", () => ({
  computeQualityScore: vi.fn(async () => ({ score: 100 })),
}));

const { upsertMock } = vi.hoisted(() => ({ upsertMock: vi.fn(async (args: { create: unknown }) => args.create) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    timetableDraft: { create: vi.fn(), update: vi.fn(async () => ({})) },
    timetableSubjectRequirement: { findMany: vi.fn() },
    timetableDraftSlot: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), upsert: upsertMock },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

import { prisma } from "@/lib/prisma";
import { generateDraft } from "@/lib/smart-timetable-generator";

const requirementsFindManyMock = (prisma as unknown as { timetableSubjectRequirement: { findMany: ReturnType<typeof vi.fn> } }).timetableSubjectRequirement.findMany;

const CANONICAL_MATH_REQUIREMENT = {
  id: "req-math",
  schoolId: "school-1",
  classId: "class-10",
  sectionId: "section-a",
  subjectId: "subj-math",
  subjectName: "Mathematics",
  requiredPeriodsPerWeek: 1,
  minPeriodsPerDay: null,
  maxPeriodsPerDay: null,
  allowConsecutive: false,
  preferredTeacherId: null,
};

const LEGACY_UNMAPPED_REQUIREMENT = {
  id: "req-legacy",
  schoolId: "school-1",
  classId: "class-10",
  sectionId: "section-a",
  subjectId: null,
  subjectName: "Moral Science",
  requiredPeriodsPerWeek: 2,
  minPeriodsPerDay: null,
  maxPeriodsPerDay: null,
  allowConsecutive: false,
  preferredTeacherId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockImplementation(async (args: { create: unknown }) => args.create);
});

describe("generateDraft — legacy/unmapped requirements are skipped, never placed", () => {
  it("a legacy unmapped requirement produces a LEGACY_SUBJECT_UNMAPPED diagnostic instead of being placed", async () => {
    requirementsFindManyMock.mockResolvedValue([CANONICAL_MATH_REQUIREMENT, LEGACY_UNMAPPED_REQUIREMENT]);

    const result = await generateDraft({
      schoolId: "school-1",
      classId: "class-10",
      sectionId: "section-a",
      draftId: "draft-1",
      completionMode: "COMPLETE_REMAINING_ONLY",
      createdById: "user-1",
    });

    const legacyDiagnostic = result.diagnostics.find((d) => d.code === "LEGACY_SUBJECT_UNMAPPED");
    expect(legacyDiagnostic).toMatchObject({ subjectName: "Moral Science" });
  });

  it("never calls computeCompatibleSlots (or any placement machinery) for the legacy subject — it is skipped, not attempted-and-failed", async () => {
    requirementsFindManyMock.mockResolvedValue([CANONICAL_MATH_REQUIREMENT, LEGACY_UNMAPPED_REQUIREMENT]);
    const { computeCompatibleSlots } = await import("@/lib/smart-timetable-slots");

    await generateDraft({ schoolId: "school-1", classId: "class-10", sectionId: "section-a", draftId: "draft-1", createdById: "user-1" });

    const subjectNamesQueried = (computeCompatibleSlots as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].subjectName);
    expect(subjectNamesQueried).not.toContain("Moral Science");
    expect(subjectNamesQueried.every((n: string) => normalizeSubjectName(n) === "mathematics")).toBe(true);
  });

  it("every newly placed slot (draft) is backed by the canonical Master-Subject-linked requirement, never the legacy one", async () => {
    requirementsFindManyMock.mockResolvedValue([CANONICAL_MATH_REQUIREMENT, LEGACY_UNMAPPED_REQUIREMENT]);

    await generateDraft({ schoolId: "school-1", classId: "class-10", sectionId: "section-a", draftId: "draft-1", createdById: "user-1" });

    expect(upsertMock).toHaveBeenCalled();
    for (const call of upsertMock.mock.calls) {
      const created = (call[0] as { create: { subjectName: string } }).create;
      expect(created.subjectName).toBe("Mathematics");
    }
  });

  it("requiredCount excludes the legacy requirement's periods (only canonical requirements count toward completion)", async () => {
    requirementsFindManyMock.mockResolvedValue([CANONICAL_MATH_REQUIREMENT, LEGACY_UNMAPPED_REQUIREMENT]);

    const result = await generateDraft({ schoolId: "school-1", classId: "class-10", sectionId: "section-a", draftId: "draft-1", createdById: "user-1" });

    // CANONICAL_MATH_REQUIREMENT.requiredPeriodsPerWeek = 1; legacy's 2 periods must not be counted.
    expect(result.requiredCount).toBe(1);
  });

  it("with no legacy rows at all, generation behaves as before (no LEGACY_SUBJECT_UNMAPPED diagnostic)", async () => {
    requirementsFindManyMock.mockResolvedValue([CANONICAL_MATH_REQUIREMENT]);

    const result = await generateDraft({ schoolId: "school-1", classId: "class-10", sectionId: "section-a", draftId: "draft-1", createdById: "user-1" });

    expect(result.diagnostics.find((d) => d.code === "LEGACY_SUBJECT_UNMAPPED")).toBeUndefined();
    expect(result.requiredCount).toBe(1);
  });
});
