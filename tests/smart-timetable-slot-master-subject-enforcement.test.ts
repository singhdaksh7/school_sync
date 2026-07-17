import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves upsertDraftSlot (the manual-builder / "regeneration/update flow"
 * path, reached by both the custom-timetable UI's slot-assignment dialog and
 * directly by POST .../drafts/[draftId]/slots) rejects any subjectName that
 * isn't backed by a canonical (subjectId-linked) TimetableSubjectRequirement
 * for this section — the same invariant enforced in generateDraft, closing
 * the manual path a caller could otherwise use to smuggle an arbitrary or
 * legacy/unmapped subject straight into a draft (and, on publish, a live)
 * slot without ever going through Master Subject validation.
 */

vi.mock("@/lib/smart-timetable-context", () => ({
  loadGenerationContext: vi.fn(async () => ({
    schoolId: "school-1",
    workingDays: 6,
    periodsPerDay: 6,
    capacity: 36,
    schoolDefaults: {},
    teachers: new Map(),
    teacherOccupancy: new Map(),
    sectionOccupancy: new Map(),
  })),
  reserveSlot: vi.fn(),
  isTeacherEligibleForSubject: vi.fn(() => true),
  normalizeSubjectName: (s: string) => s.trim().toLowerCase(),
}));
vi.mock("@/lib/teacher-workload-rules", () => ({ resolveEffectiveWorkloadRule: vi.fn(() => ({})) }));
vi.mock("@/lib/smart-timetable-constraints", () => ({ checkHardConstraints: vi.fn(() => []) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    timetableDraftSlot: { findUnique: vi.fn(async () => null), upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({ id: "slot-1", ...args.create })) },
    timetableSubjectRequirement: { findMany: vi.fn() },
    timetableDraft: { update: vi.fn(async () => ({})) },
  },
}));

import { prisma } from "@/lib/prisma";
import { upsertDraftSlot } from "@/lib/smart-timetable-drafts";

const requirementsFindManyMock = (prisma as unknown as { timetableSubjectRequirement: { findMany: ReturnType<typeof vi.fn> } }).timetableSubjectRequirement.findMany;

const BASE_ARGS = { draftId: "draft-1", schoolId: "school-1", sectionId: "section-a", dayOfWeek: 1, period: 1, teacherId: null };

beforeEach(() => vi.clearAllMocks());

describe("upsertDraftSlot — Master Subject enforcement on manual slot assignment", () => {
  it("rejects a subjectName with no canonical (subjectId-linked) requirement for this section (arbitrary subject)", async () => {
    requirementsFindManyMock.mockResolvedValue([]); // no canonical requirements configured at all
    const result = await upsertDraftSlot({ ...BASE_ARGS, subjectName: "Made Up Subject" });
    expect(result).toMatchObject({ ok: false, code: "SUBJECT_NOT_APPLICABLE" });
  });

  it("rejects a legacy/unmapped requirement's subjectName (subjectId: null) — matches the requirement query, which excludes it", async () => {
    // findApplicableSubject-style scoping is applied at the query level: only subjectId-not-null rows are ever returned here.
    requirementsFindManyMock.mockImplementation(async ({ where }: { where: { subjectId?: { not: null } } }) => {
      // Simulate a real DB: only canonical rows match `subjectId: { not: null }`.
      const rows = [{ subjectName: "Mathematics", subjectId: "subj-math" }];
      return where.subjectId ? rows : [...rows, { subjectName: "Moral Science", subjectId: null }];
    });
    const result = await upsertDraftSlot({ ...BASE_ARGS, subjectName: "Moral Science" });
    expect(result).toMatchObject({ ok: false, code: "SUBJECT_NOT_APPLICABLE" });
    expect(requirementsFindManyMock).toHaveBeenCalledWith({
      where: { sectionId: "section-a", subjectId: { not: null } },
      select: { subjectName: true },
    });
  });

  it("accepts a subjectName that matches a canonical requirement (case-insensitively)", async () => {
    requirementsFindManyMock.mockResolvedValue([{ subjectName: "Mathematics" }]);
    const result = await upsertDraftSlot({ ...BASE_ARGS, subjectName: "  MATHEMATICS  " });
    expect(result.ok).toBe(true);
  });

  it("allows clearing a slot (subjectName: null) without any Master Subject check", async () => {
    const result = await upsertDraftSlot({ ...BASE_ARGS, subjectName: null });
    expect(result.ok).toBe(true);
    expect(requirementsFindManyMock).not.toHaveBeenCalled();
  });

  it("still refuses to overwrite a locked slot regardless of subject validity (existing behaviour preserved)", async () => {
    (prisma.timetableDraftSlot.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ locked: true });
    requirementsFindManyMock.mockResolvedValue([{ subjectName: "Mathematics" }]);
    const result = await upsertDraftSlot({ ...BASE_ARGS, subjectName: "Mathematics" });
    expect(result).toMatchObject({ ok: false, code: "LOCKED_SLOT_CONFLICT" });
  });
});
