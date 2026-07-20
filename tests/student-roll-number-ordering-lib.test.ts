import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies the shared canonical roll-number comparator is actually wired
 * into the lib-level helpers that feed multiple screens at once (attendance
 * roster shared by teacher + admin flows; getTeacherAssignments shared by
 * homework/marks/notebook screens).
 */

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { student: { findMany: findManyMock }, teacher: { findFirst: vi.fn() } },
}));

import { getEligibleStudentIds } from "@/lib/attendance-roster";

beforeEach(() => vi.clearAllMocks());

describe("getEligibleStudentIds — attendance roster (shared teacher + admin flow)", () => {
  it("returns student ids in canonical roll-number order regardless of the DB fetch order", async () => {
    findManyMock.mockResolvedValue([
      { id: "s-10", rollNo: "10", name: "Ten", admissionNo: null },
      { id: "s-1", rollNo: "1", name: "One", admissionNo: null },
      { id: "s-2", rollNo: "2", name: "Two", admissionNo: null },
    ]);
    const ids = await getEligibleStudentIds("school-1", "section-a");
    expect(ids).toEqual(["s-1", "s-2", "s-10"]);
  });

  it("scopes the fetch by schoolId and sectionId (tenant isolation)", async () => {
    findManyMock.mockResolvedValue([]);
    await getEligibleStudentIds("school-1", "section-a");
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { schoolId: "school-1", sectionId: "section-a" } }));
  });
});

describe("getTeacherAssignments — shared homework/marks/notebook student roster", () => {
  it("orders a section's students canonically for both timetable-slot and mentor-section paths", async () => {
    vi.resetModules();
    const teacherFindFirstMock = vi.fn(async () => ({
      subject: "Mathematics",
      timetableSlots: [
        {
          sectionId: "section-a",
          subject: null,
          section: {
            name: "A",
            class: { id: "class-10", name: "10" },
            students: [
              { id: "s-10", name: "Ten", rollNo: "10" },
              { id: "s-2", name: "Two", rollNo: "2" },
            ],
          },
        },
      ],
      mentorSection: {
        id: "section-b",
        name: "B",
        class: { id: "class-9", name: "9" },
        students: [
          { id: "s-b-20", name: "Twenty", rollNo: "20" },
          { id: "s-b-3", name: "Three", rollNo: "3" },
        ],
      },
    }));
    vi.doMock("@/lib/prisma", () => ({ prisma: { teacher: { findFirst: teacherFindFirstMock } } }));
    vi.doMock("@/lib/file-service", () => ({ resolveManagedOrLegacyUrl: vi.fn() }));

    const { getTeacherAssignments } = await import("@/lib/homework");
    const assignments = await getTeacherAssignments("teacher-1", "school-1");

    const slotAssignment = assignments.find((a) => a.sectionId === "section-a")!;
    expect(slotAssignment.students.map((s) => s.rollNo)).toEqual(["2", "10"]);

    const mentorAssignment = assignments.find((a) => a.sectionId === "section-b")!;
    expect(mentorAssignment.students.map((s) => s.rollNo)).toEqual(["3", "20"]);

    vi.doUnmock("@/lib/prisma");
    vi.doUnmock("@/lib/file-service");
  });
});
