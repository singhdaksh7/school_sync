import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    announcement: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    announcementTarget: { deleteMany: vi.fn() },
    announcementAudience: { deleteMany: vi.fn() },
    teacher: { findFirst: vi.fn() },
    section: { findMany: vi.fn() },
    // requireTeacherPermission's dependencies: no TeacherRoleAssignment rows
    // -> legacy unrestricted access (matches every other pre-existing test's
    // expectations here — these tests are about strict-schema rejection, not
    // about ANNOUNCEMENTS permission enforcement, which has its own
    // dedicated test file).
    teacherRoleAssignment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    school: { findUnique: vi.fn(async () => null) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));

import { getTeacherAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as {
  announcement: { create: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
  section: { findMany: ReturnType<typeof vi.fn> };
};

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };

function postReq(body: unknown) {
  return new Request("http://localhost/api/teacher/announcements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  title: "Class notice",
  body: "Details",
  scope: "CLASS_SECTION",
  audience: ["STUDENTS"],
  targets: [{ classId: "c1", sectionId: "s1" }],
  publishNow: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
});

describe("POST /api/teacher/announcements — strict-schema rejection at the route", () => {
  it("returns 400 and never calls prisma.announcement.create when the body carries a client-supplied schoolId/createdById", async () => {
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq({ ...VALID_BODY, schoolId: "attacker-school", createdById: "attacker-teacher" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("schoolId");
    expect(body.error).toContain("createdById");
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("returns 400 for any other unrecognized extra field too (proves .strict(), not a schoolId-specific allowlist check)", async () => {
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq({ ...VALID_BODY, isAdmin: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("isAdmin");
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("accepts the identical payload once the extra fields are removed", async () => {
    p.teacher.findFirst.mockResolvedValue({ timetableSlots: [{ section: { id: "s1", classId: "c1", name: "A", class: { name: "5" } } }], mentorSection: null });
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(201);
  });
});
