import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Pure helpers (no mocking needed) ──────────────────────────────────────────
import { clearStaleSubjectSelections } from "@/lib/smart-timetable-requirement-reconciliation";
import { createRequestSequencer } from "@/lib/request-sequencer";

describe("clearStaleSubjectSelections (Smart Timetable requirements UI reconciliation)", () => {
  it("clears an unsaved row's subjectId when it's no longer among the valid options (class/section changed)", () => {
    const requirements = [{ subjectId: "subj-old", subjectName: "Mathematics", requiredPeriodsPerWeek: 3 }];
    const result = clearStaleSubjectSelections(requirements, new Set(["subj-new"]));
    expect(result[0].subjectId).toBeNull();
    expect(result[0].subjectName).toBe("");
  });

  it("leaves a row untouched when its subjectId is still valid", () => {
    const requirements = [{ subjectId: "subj-1", subjectName: "Science", requiredPeriodsPerWeek: 4 }];
    const result = clearStaleSubjectSelections(requirements, new Set(["subj-1"]));
    expect(result[0].subjectId).toBe("subj-1");
  });

  it("never invents a subjectId for a legacy row (has a persisted id, subjectId already null)", () => {
    const requirements = [{ id: "req-1", subjectId: null, subjectName: "Old Free-Text Subject", requiredPeriodsPerWeek: 2 }];
    const result = clearStaleSubjectSelections(requirements, new Set(["subj-1"]));
    expect(result[0]).toEqual(requirements[0]);
  });

  it("does not clear a persisted (has id) row even if its subjectId is momentarily absent from the options list", () => {
    // Persisted canonical rows are refreshed straight from the server response (which already
    // reflects the current class/section), so this function must not second-guess them.
    const requirements = [{ id: "req-2", subjectId: "subj-stale", subjectName: "Mathematics", requiredPeriodsPerWeek: 3 }];
    const result = clearStaleSubjectSelections(requirements, new Set(["subj-other"]));
    expect(result[0].subjectId).toBe("subj-stale");
  });
});

describe("createRequestSequencer (race protection for class/section subject fetches)", () => {
  it("a stale (earlier) token is no longer current once a newer one has been issued", () => {
    const seq = createRequestSequencer();
    const first = seq.next();
    const second = seq.next();
    expect(seq.isCurrent(first)).toBe(false);
    expect(seq.isCurrent(second)).toBe(true);
  });

  it("simulates an out-of-order resolve: a slow first request must not win against a faster second request", async () => {
    const seq = createRequestSequencer();
    const applied: string[] = [];

    function fetchAndApply(token: number, delayMs: number, label: string) {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (seq.isCurrent(token)) applied.push(label);
          resolve();
        }, delayMs);
      });
    }

    const slowToken = seq.next(); // issued first, resolves last
    const fastPromise = (async () => {
      const fastToken = seq.next(); // issued second, resolves first
      await fetchAndApply(fastToken, 5, "fast");
    })();
    const slowPromise = fetchAndApply(slowToken, 30, "slow");

    await Promise.all([fastPromise, slowPromise]);
    expect(applied).toEqual(["fast"]);
  });
});

// ── getApplicableSubjects / findApplicableSubject (Master Subject resolution) ─
vi.mock("@/lib/prisma", () => ({
  prisma: {
    subject: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getApplicableSubjects, findApplicableSubject } from "@/lib/master-subjects";

const subjectMock = prisma as unknown as {
  subject: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
};

function subj(overrides: Partial<{ id: string; schoolId: string; classId: string; sectionId: string | null; name: string }>) {
  return { id: "s-1", schoolId: "school-1", classId: "class-10", sectionId: null, name: "Mathematics", createdAt: new Date(), ...overrides };
}

describe("getApplicableSubjects — Master Subject applicability resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes class-wide (all-sections) Master Subjects for Class 10-A", async () => {
    subjectMock.subject.findMany
      .mockResolvedValueOnce([]) // section-specific
      .mockResolvedValueOnce([subj({ id: "s-math", name: "Mathematics", sectionId: null })]); // class-wide
    const result = await getApplicableSubjects("school-1", "class-10", "section-a");
    expect(result.map((s) => s.name)).toEqual(["Mathematics"]);
  });

  it("includes a section-A-specific subject for 10-A", async () => {
    subjectMock.subject.findMany
      .mockResolvedValueOnce([subj({ id: "s-art", name: "Art", sectionId: "section-a" })])
      .mockResolvedValueOnce([]);
    const result = await getApplicableSubjects("school-1", "class-10", "section-a");
    expect(result.map((s) => s.name)).toEqual(["Art"]);
  });

  it("does not surface a section-B-only subject when resolving for 10-A", async () => {
    // The section-specific query is itself scoped to sectionId: "section-a", so a
    // section-B-only row is never returned by the (mocked) first call at all.
    subjectMock.subject.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result = await getApplicableSubjects("school-1", "class-10", "section-a");
    expect(result).toEqual([]);
    expect(subjectMock.subject.findMany).toHaveBeenNthCalledWith(1, { where: { schoolId: "school-1", classId: "class-10", sectionId: "section-a" } });
  });

  it("excludes another class's subjects (Class 9 subjects never appear for Class 10)", async () => {
    subjectMock.subject.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await getApplicableSubjects("school-1", "class-10", "section-a");
    expect(subjectMock.subject.findMany).toHaveBeenNthCalledWith(2, { where: { schoolId: "school-1", classId: "class-10", sectionId: null } });
  });

  it("excludes another school's subjects by construction (schoolId is always part of the query)", async () => {
    subjectMock.subject.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await getApplicableSubjects("school-1", "class-10", "section-a");
    for (const call of subjectMock.subject.findMany.mock.calls) {
      expect(call[0].where.schoolId).toBe("school-1");
    }
  });

  it("deduplicates a subject applicable through both a class-wide and section-specific assignment, keeping the section-specific row", async () => {
    subjectMock.subject.findMany
      .mockResolvedValueOnce([subj({ id: "s-section", name: "Mathematics", sectionId: "section-a" })])
      .mockResolvedValueOnce([subj({ id: "s-classwide", name: "mathematics", sectionId: null })]);
    const result = await getApplicableSubjects("school-1", "class-10", "section-a");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s-section");
  });

  it("returns a stable, name-sorted order", async () => {
    subjectMock.subject.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([subj({ id: "s-2", name: "Science" }), subj({ id: "s-1", name: "English" })]);
    const result = await getApplicableSubjects("school-1", "class-10", "section-a");
    expect(result.map((s) => s.name)).toEqual(["English", "Science"]);
  });
});

describe("findApplicableSubject — server-side single-subject resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a valid class-wide-or-section-specific subject", async () => {
    subjectMock.subject.findFirst.mockResolvedValue(subj({ id: "s-math" }));
    const result = await findApplicableSubject("s-math", "school-1", "class-10", "section-a");
    expect(result?.id).toBe("s-math");
    expect(subjectMock.subject.findFirst).toHaveBeenCalledWith({
      where: { id: "s-math", schoolId: "school-1", classId: "class-10", OR: [{ sectionId: null }, { sectionId: "section-a" }] },
    });
  });

  it("returns null for an id that doesn't resolve under this school/class/section scope", async () => {
    subjectMock.subject.findFirst.mockResolvedValue(null);
    const result = await findApplicableSubject("nonexistent", "school-1", "class-10", "section-a");
    expect(result).toBeNull();
  });
});
