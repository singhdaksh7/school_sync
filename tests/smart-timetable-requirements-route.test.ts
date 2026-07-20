import { beforeEach, describe, expect, it, vi } from "vitest";

// ── PUT/GET /api/schools/[schoolId]/smart-timetable/requirements — server enforcement ─
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  canAccessSchool: vi.fn(async () => true),
  canWriteSchool: vi.fn(async () => true),
  classBelongsToSchool: vi.fn(async () => true),
  sectionBelongsToSchool: vi.fn(async () => true),
  teacherBelongsToSchool: vi.fn(async () => true),
  sessionRole: (user: unknown) => (user as { role?: string })?.role,
}));
vi.mock("@/lib/master-subjects", () => ({
  findApplicableSubject: vi.fn(),
  getApplicableSubjects: vi.fn(),
}));
vi.mock("@/lib/smart-timetable-drafts", () => ({
  getSubjectRequirements: vi.fn(async () => []),
  setSubjectRequirements: vi.fn(async (args: { requirements: unknown[] }) => args.requirements),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUniqueOrThrow: vi.fn(async () => ({ timetableWorkingDays: 6, periodsPerDay: 6 })) },
  },
}));

import { auth } from "@/lib/auth";
import { canWriteSchool, classBelongsToSchool, sectionBelongsToSchool, teacherBelongsToSchool } from "@/lib/tenant";
import { findApplicableSubject as findApplicableSubjectMocked } from "@/lib/master-subjects";
import { setSubjectRequirements as setSubjectRequirementsMocked, getSubjectRequirements as getSubjectRequirementsMocked } from "@/lib/smart-timetable-drafts";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const canWriteSchoolMock = canWriteSchool as unknown as ReturnType<typeof vi.fn>;
const classBelongsMock = classBelongsToSchool as unknown as ReturnType<typeof vi.fn>;
const sectionBelongsMock = sectionBelongsToSchool as unknown as ReturnType<typeof vi.fn>;
const teacherBelongsMock = teacherBelongsToSchool as unknown as ReturnType<typeof vi.fn>;
const findApplicableMock = findApplicableSubjectMocked as unknown as ReturnType<typeof vi.fn>;
const setSubjectRequirementsMock = setSubjectRequirementsMocked as unknown as ReturnType<typeof vi.fn>;
const getSubjectRequirementsMock = getSubjectRequirementsMocked as unknown as ReturnType<typeof vi.fn>;

function putReq(body: unknown) {
  return new Request("http://localhost/api/schools/school-1/smart-timetable/requirements", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: Promise.resolve({ schoolId: "school-1" }) };
const VALID_SUBJECT = { id: "subj-math", name: "Mathematics" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1", role: "SCHOOL_ADMIN" } });
  canWriteSchoolMock.mockResolvedValue(true);
  classBelongsMock.mockResolvedValue(true);
  sectionBelongsMock.mockResolvedValue(true);
  teacherBelongsMock.mockResolvedValue(true);
  findApplicableMock.mockResolvedValue(VALID_SUBJECT);
  getSubjectRequirementsMock.mockResolvedValue([]);
  setSubjectRequirementsMock.mockImplementation(async (args: { requirements: { subjectId: string; subjectName: string }[] }) => args.requirements);
});

describe("PUT smart-timetable requirements — server-side Master Subject enforcement", () => {
  it("rejects an arbitrary/nonexistent subjectId (never trusts the dropdown alone)", async () => {
    findApplicableMock.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "made-up-id", requiredPeriodsPerWeek: 3 }] }),
      PARAMS
    );
    expect(res.status).toBe(422);
    expect(setSubjectRequirementsMock).not.toHaveBeenCalled();
  });

  it("rejects a subject that belongs to a different school (findApplicableSubject correctly scoped, returns null)", async () => {
    findApplicableMock.mockResolvedValue(null); // simulates the cross-school lookup finding nothing
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "other-school-subject", requiredPeriodsPerWeek: 3 }] }),
      PARAMS
    );
    expect(res.status).toBe(422);
    expect(findApplicableMock).toHaveBeenCalledWith("other-school-subject", "school-1", "class-10", "section-a");
  });

  it("rejects a subject that exists but only for another class/section", async () => {
    findApplicableMock.mockResolvedValue(null); // findApplicableSubject itself scopes by classId/sectionId
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "class-9-subject", requiredPeriodsPerWeek: 3 }] }),
      PARAMS
    );
    expect(res.status).toBe(422);
  });

  it("rejects when requirements is present but no Master Subjects are configured at all (empty config)", async () => {
    findApplicableMock.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "anything", requiredPeriodsPerWeek: 3 }] }),
      PARAMS
    );
    expect(res.status).toBe(422);
    expect(setSubjectRequirementsMock).not.toHaveBeenCalled();
  });

  it("saves successfully with a valid Master Subject requirement and derives subjectName from the canonical record (ignores any client-sent name)", async () => {
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({
        classId: "class-10",
        sectionId: "section-a",
        requirements: [{ subjectId: "subj-math", subjectName: "SPOOFED NAME", requiredPeriodsPerWeek: 6 }],
      }),
      PARAMS
    );
    expect(res.status).toBe(200);
    expect(setSubjectRequirementsMock).toHaveBeenCalledTimes(1);
    const saved = setSubjectRequirementsMock.mock.calls[0][0].requirements;
    expect(saved[0]).toMatchObject({ subjectId: "subj-math", subjectName: "Mathematics", requiredPeriodsPerWeek: 6 });
  });

  it("applies the identical validation on an update (same requirements payload shape, re-validated every time)", async () => {
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "subj-math", requiredPeriodsPerWeek: 6 }] }),
      PARAMS
    );
    expect(findApplicableMock).toHaveBeenCalledWith("subj-math", "school-1", "class-10", "section-a");

    findApplicableMock.mockResolvedValue(null);
    const res2 = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "subj-now-invalid", requiredPeriodsPerWeek: 6 }] }),
      PARAMS
    );
    expect(res2.status).toBe(422);
  });

  it("a VICE_PRINCIPAL (read-only delegated role) is still forbidden from writing requirements — existing authorization unaffected", async () => {
    authMock.mockResolvedValue({ user: { id: "user-2", role: "VICE_PRINCIPAL" } });
    canWriteSchoolMock.mockResolvedValue(false);
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "subj-math", requiredPeriodsPerWeek: 6 }] }),
      PARAMS
    );
    expect(res.status).toBe(403);
    expect(setSubjectRequirementsMock).not.toHaveBeenCalled();
  });

  it("a SCHOOL_ADMIN can still save requirements (existing authorized behaviour preserved)", async () => {
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ subjectId: "subj-math", requiredPeriodsPerWeek: 6 }] }),
      PARAMS
    );
    expect(res.status).toBe(200);
  });

  it("rejects a missing subjectId with a 400 (shape validation happens before the DB lookup)", async () => {
    const { PUT } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await PUT(
      putReq({ classId: "class-10", sectionId: "section-a", requirements: [{ requiredPeriodsPerWeek: 6 }] }),
      PARAMS
    );
    expect(res.status).toBe(400);
    expect(findApplicableMock).not.toHaveBeenCalled();
  });
});

describe("GET smart-timetable requirements — legacy rows remain readable", () => {
  it("returns a pre-existing legacy (subjectId: null) row untouched alongside canonical rows", async () => {
    getSubjectRequirementsMock.mockResolvedValue([
      { id: "req-legacy", subjectId: null, subjectName: "Moral Science", requiredPeriodsPerWeek: 2 },
      { id: "req-canonical", subjectId: "subj-math", subjectName: "Mathematics", requiredPeriodsPerWeek: 6 },
    ]);
    const { GET } = await import("@/app/api/schools/[schoolId]/smart-timetable/requirements/route");
    const res = await GET(new Request("http://localhost/api/schools/school-1/smart-timetable/requirements?sectionId=section-a"), PARAMS);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.requirements).toHaveLength(2);
    expect(data.requirements.find((r: { id: string }) => r.id === "req-legacy")).toMatchObject({ subjectId: null, subjectName: "Moral Science" });
  });
});
