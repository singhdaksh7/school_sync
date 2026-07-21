import { beforeEach, describe, expect, it, vi } from "vitest";

// Real setSubjectRequirements implementation under test — only its DB-facing
// dependencies are mocked, so the delete/upsert filter logic itself is exercised.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    timetableSubjectRequirement: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async (args: { create: unknown }) => args.create),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));
vi.mock("@/lib/smart-timetable-context", () => ({
  loadGenerationContext: vi.fn(),
  reserveSlot: vi.fn(),
  isTeacherEligibleForSubject: vi.fn(),
  normalizeSubjectName: (s: string) => s.trim().toLowerCase(),
}));
vi.mock("@/lib/teacher-workload-rules", () => ({ resolveEffectiveWorkloadRule: vi.fn() }));
vi.mock("@/lib/smart-timetable-constraints", () => ({ checkHardConstraints: vi.fn(() => []) }));

import { prisma } from "@/lib/prisma";
import { setSubjectRequirements } from "@/lib/smart-timetable-drafts";

const p = prisma as unknown as {
  timetableSubjectRequirement: {
    deleteMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => vi.clearAllMocks());

describe("setSubjectRequirements — legacy-row preservation at the persistence layer", () => {
  it("the delete filter targets only subjectId (never subjectName), so a legacy NULL-subjectId row can never match it and be deleted", async () => {
    await setSubjectRequirements({
      schoolId: "school-1",
      classId: "class-10",
      sectionId: "section-a",
      requirements: [{ subjectId: "subj-math", subjectName: "Mathematics", requiredPeriodsPerWeek: 6 }],
    });

    expect(p.timetableSubjectRequirement.deleteMany).toHaveBeenCalledWith({
      where: { sectionId: "section-a", subjectId: { notIn: ["subj-math"] } },
    });
  });

  it("upserts on the sectionId_subjectId key, keyed by the canonical subjectId", async () => {
    await setSubjectRequirements({
      schoolId: "school-1",
      classId: "class-10",
      sectionId: "section-a",
      requirements: [{ subjectId: "subj-math", subjectName: "Mathematics", requiredPeriodsPerWeek: 6 }],
    });

    expect(p.timetableSubjectRequirement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sectionId_subjectId: { sectionId: "section-a", subjectId: "subj-math" } } })
    );
  });

  it("an empty requirement list still only deletes canonical rows (uses the __none__ sentinel, not an empty notIn)", async () => {
    await setSubjectRequirements({ schoolId: "school-1", classId: "class-10", sectionId: "section-a", requirements: [] });
    expect(p.timetableSubjectRequirement.deleteMany).toHaveBeenCalledWith({
      where: { sectionId: "section-a", subjectId: { notIn: ["__none__"] } },
    });
    expect(p.timetableSubjectRequirement.upsert).not.toHaveBeenCalled();
  });
});
