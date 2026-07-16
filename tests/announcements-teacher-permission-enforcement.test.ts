import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the ANNOUNCEMENTS permission-enforcement work: the standard
 * requireTeacherPermission mechanism (same one HOMEWORK/ATTENDANCE/etc. use)
 * layered on top of — never instead of — the pre-existing timetable/mentor
 * class-authority check. `@/lib/teacher-authorization` and
 * `@/lib/teacher-permissions` are deliberately left UNMOCKED so the real
 * authorizeTeacher/getTeacherScope/teacherHasPermission logic runs against
 * a controlled TeacherRoleAssignment fixture — this is what actually proves
 * the mechanism, not a stub standing in for it.
 */
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    announcement: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    announcementTarget: { deleteMany: vi.fn() },
    announcementAudience: { deleteMany: vi.fn() },
    announcementRead: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    teacher: { findFirst: vi.fn() },
    section: { findMany: vi.fn() },
    teacherRoleAssignment: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    school: { findUnique: vi.fn(async () => null) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});

import { getTeacherAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as {
  announcement: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
  section: { findMany: ReturnType<typeof vi.fn> };
  teacherRoleAssignment: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };

/** No TeacherRoleAssignment rows at all -> legacy unrestricted access (the opt-in default). */
function noCustomRole() {
  p.teacherRoleAssignment.count.mockResolvedValue(0);
  p.teacherRoleAssignment.findMany.mockResolvedValue([]);
  p.teacherRoleAssignment.findFirst.mockResolvedValue(null);
}

/** A custom role is assigned, granting exactly `grantedActions` on ANNOUNCEMENTS, scoped to `classIds`/`sectionIds` (empty = unrestricted-within-the-module). */
function customRole(grantedActions: string[], scope: { classIds: string[]; sectionIds: string[] } = { classIds: [], sectionIds: [] }) {
  p.teacherRoleAssignment.count.mockResolvedValue(1);
  p.teacherRoleAssignment.findMany.mockResolvedValue([{ classIds: scope.classIds, sectionIds: scope.sectionIds }]);
  p.teacherRoleAssignment.findFirst.mockImplementation(async ({ where }: { where: { role: { permissions: { some: { module: string; action: { in: string[] } } } } } }) => {
    const check = where.role.permissions.some;
    if (check.module === "ANNOUNCEMENTS" && grantedActions.some((a) => check.action.in.includes(a))) {
      return { id: "assignment-1" };
    }
    return null;
  });
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/teacher/announcements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function patchReq(url: string, body: unknown) {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function getReq(url: string) {
  return new Request(url);
}

const CLASS_SECTION_BODY = {
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
  p.teacher.findFirst.mockResolvedValue({
    timetableSlots: [{ section: { id: "s1", classId: "c1", name: "A", class: { name: "5" } } }],
    mentorSection: null,
  });
  p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
});

describe("POST /api/teacher/announcements — ANNOUNCEMENTS permission enforcement", () => {
  it("a teacher with no custom role assignment keeps legacy unrestricted access and can create for a class/section they teach", async () => {
    noCustomRole();
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(CLASS_SECTION_BODY));
    expect(res.status).toBe(201);
    expect(p.announcement.create).toHaveBeenCalled();
  });

  it("a teacher with a custom role granting ANNOUNCEMENTS:CREATE, unrestricted scope, and assigned to the target class can create", async () => {
    customRole(["CREATE"]);
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(CLASS_SECTION_BODY));
    expect(res.status).toBe(201);
    expect(p.announcement.create).toHaveBeenCalled();
  });

  it("a teacher whose custom role does NOT grant ANNOUNCEMENTS:CREATE is denied — role alone (STUDENTS/HOMEWORK etc.) never bypasses a missing permission", async () => {
    customRole(["VIEW"]); // some other ANNOUNCEMENTS action granted, but not CREATE
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(CLASS_SECTION_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("MISSING_PERMISSION");
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("a teacher WITH ANNOUNCEMENTS:CREATE but whose custom-role scope excludes the target class/section is still denied — permission never expands class access", async () => {
    customRole(["CREATE"], { classIds: ["some-other-class"], sectionIds: ["some-other-section"] });
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(CLASS_SECTION_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("OUT_OF_SCOPE");
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("class/section teaching authority is still checked independently of RBAC permission: unrestricted custom role + CREATE granted, but no timetable/mentor assignment to the target section, is still denied", async () => {
    customRole(["CREATE"]); // fully unrestricted RBAC scope, CREATE granted
    // No timetable slot / mentor section covering s1 at all:
    p.teacher.findFirst.mockResolvedValue({ timetableSlots: [], mentorSection: null });
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(CLASS_SECTION_BODY));
    expect(res.status).toBe(403);
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("a target section belonging to a different school is hidden/rejected, never silently created against it (IDOR)", async () => {
    noCustomRole();
    // The section lookup is always scoped by this teacher's own schoolId
    // (validateTargets), so a cross-school sectionId simply never resolves.
    p.section.findMany.mockResolvedValue([]);
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(CLASS_SECTION_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/do not belong to this school/);
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("teachers cannot select SCHOOL_WIDE scope, even with every permission granted", async () => {
    noCustomRole();
    const schoolWide = { ...CLASS_SECTION_BODY, scope: "SCHOOL_WIDE", targets: [] };
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(schoolWide));
    expect(res.status).toBe(403);
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("teachers cannot target the TEACHERS audience group, even with every permission granted", async () => {
    noCustomRole();
    const withTeachers = { ...CLASS_SECTION_BODY, audience: ["TEACHERS"] };
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(withTeachers));
    expect(res.status).toBe(403);
    expect(p.announcement.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/teacher/announcements — VIEW permission + server-derived authorized sections", () => {
  it("denies listing when a custom role exists but ANNOUNCEMENTS:VIEW is not granted", async () => {
    customRole(["CREATE"]); // some other action granted, not VIEW
    const { GET } = await import("@/app/api/teacher/announcements/route");
    const res = await GET(getReq("http://localhost/api/teacher/announcements?mine=1"));
    expect(res.status).toBe(403);
  });

  it("authorizedSections is gated by CREATE permission and returns server-derived class/section pairs — never client input", async () => {
    customRole(["CREATE"]);
    const { GET } = await import("@/app/api/teacher/announcements/route");
    const res = await GET(getReq("http://localhost/api/teacher/announcements?authorizedSections=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections).toEqual([{ classId: "c1", sectionId: "s1", className: "5", sectionName: "A" }]);
  });

  it("authorizedSections is denied when the custom role lacks CREATE", async () => {
    customRole(["VIEW"]);
    const { GET } = await import("@/app/api/teacher/announcements/route");
    const res = await GET(getReq("http://localhost/api/teacher/announcements?authorizedSections=1"));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/teacher/announcements/[id] — cross-school hidden as 404 (never enumerable)", () => {
  it("returns 404, not 403, for an announcement belonging to a different school", async () => {
    noCustomRole();
    // The route's own where clause is schoolId-scoped, so a cross-school id
    // is simply never found — no distinguishable "exists but forbidden" leak.
    p.announcement.findFirst.mockResolvedValue(null);
    const { GET } = await import("@/app/api/teacher/announcements/[announcementId]/route");
    const res = await GET(getReq("http://localhost/api/teacher/announcements/other-school-ann"), {
      params: Promise.resolve({ announcementId: "other-school-ann" }),
    });
    expect(res.status).toBe(404);
  });

  it("denies with 403 before ever touching the DB when ANNOUNCEMENTS:VIEW is not granted (permission gate runs first)", async () => {
    customRole(["CREATE"]);
    const { GET } = await import("@/app/api/teacher/announcements/[announcementId]/route");
    const res = await GET(getReq("http://localhost/api/teacher/announcements/a1"), {
      params: Promise.resolve({ announcementId: "a1" }),
    });
    expect(res.status).toBe(403);
    expect(p.announcement.findFirst).not.toHaveBeenCalled();
  });
});

describe("Teacher UI flows — create/schedule/publish/cancel, exercised at the route level (no RTL/jsdom in this repo — see note below)", () => {
  /**
   * This repo has no React Testing Library / jsdom anywhere (vitest.config.ts
   * is environment:"node", tests only include *.test.ts). Rendering
   * src/app/teacher/announcements/page.tsx would require introducing a new
   * test category and dependency the codebase doesn't otherwise use. The
   * page is a thin client over these exact routes (same payload shapes,
   * same status transitions) — proving the routes end-to-end is the
   * meaningful, consistent-with-existing-conventions regression coverage
   * for "the UI flows work"; the page's own authorization gate is a 3-line
   * conditional on the `canView` flag from useTeacherPermissions(), which in
   * turn is a thin wrapper over GET /api/teacher/permissions — see the
   * "page-authorization data source" describe block below for that route's
   * own regression coverage.
   */
  beforeEach(() => noCustomRole());

  it("create with publishNow=true immediately publishes", async () => {
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(CLASS_SECTION_BODY));
    expect(res.status).toBe(201);
    const call = p.announcement.create.mock.calls[0][0];
    expect(call.data.status).toBe("PUBLISHED");
  });

  it("create with a future scheduledAt creates a SCHEDULED announcement, not published", async () => {
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });
    const scheduled = { ...CLASS_SECTION_BODY, publishNow: false, scheduledAt: new Date(Date.now() + 60_000).toISOString() };
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(scheduled));
    expect(res.status).toBe(201);
    const call = p.announcement.create.mock.calls[0][0];
    expect(call.data.status).toBe("SCHEDULED");
  });

  it("create with neither publishNow nor scheduledAt saves as DRAFT", async () => {
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });
    const draft = { ...CLASS_SECTION_BODY, publishNow: false };
    const { POST } = await import("@/app/api/teacher/announcements/route");
    const res = await POST(postReq(draft));
    expect(res.status).toBe(201);
    const call = p.announcement.create.mock.calls[0][0];
    expect(call.data.status).toBe("DRAFT");
  });

  it("PATCH action=publish transitions a DRAFT owned by this teacher to PUBLISHED", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: "school-a", status: "DRAFT", createdById: "user-1" });
    p.announcement.update.mockResolvedValue({ id: "a1", title: "t" });
    const { PATCH } = await import("@/app/api/teacher/announcements/[announcementId]/route");
    const res = await PATCH(patchReq("http://localhost/api/teacher/announcements/a1", { action: "publish" }), {
      params: Promise.resolve({ announcementId: "a1" }),
    });
    expect(res.status).toBe(200);
    const call = p.announcement.update.mock.calls[0][0];
    expect(call.data.status).toBe("PUBLISHED");
  });

  it("PATCH action=cancel transitions a PUBLISHED announcement owned by this teacher to CANCELLED", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: "school-a", status: "PUBLISHED", createdById: "user-1" });
    p.announcement.update.mockResolvedValue({ id: "a1", title: "t" });
    const { PATCH } = await import("@/app/api/teacher/announcements/[announcementId]/route");
    const res = await PATCH(patchReq("http://localhost/api/teacher/announcements/a1", { action: "cancel" }), {
      params: Promise.resolve({ announcementId: "a1" }),
    });
    expect(res.status).toBe(200);
    const call = p.announcement.update.mock.calls[0][0];
    expect(call.data.status).toBe("CANCELLED");
  });

  it("PATCH is denied with 403 before any DB write when ANNOUNCEMENTS:EDIT is not granted", async () => {
    customRole(["VIEW"]);
    const { PATCH } = await import("@/app/api/teacher/announcements/[announcementId]/route");
    const res = await PATCH(patchReq("http://localhost/api/teacher/announcements/a1", { action: "cancel" }), {
      params: Promise.resolve({ announcementId: "a1" }),
    });
    expect(res.status).toBe(403);
    expect(p.announcement.findFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/teacher/permissions — page-authorization data source (the UI's canView/canCreate/canEdit gate)", () => {
  it("a teacher with no custom role reports hasCustomRole=false — the UI hook's has() then defaults to true (unrestricted, matches route behavior)", async () => {
    noCustomRole();
    const { GET } = await import("@/app/api/teacher/permissions/route");
    const res = await GET(getReq("http://localhost/api/teacher/permissions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasCustomRole).toBe(false);
    expect(body.permissions).toEqual([]);
  });

  it("a teacher with a custom role granting only ANNOUNCEMENTS:CREATE reports exactly that — the UI hook's has('ANNOUNCEMENTS','VIEW') would be false, has('ANNOUNCEMENTS','CREATE') true", async () => {
    p.teacherRoleAssignment.count.mockResolvedValue(1);
    p.teacherRoleAssignment.findMany.mockResolvedValue([
      { classIds: [], sectionIds: [], role: { permissions: [{ module: "ANNOUNCEMENTS", action: "CREATE", allowed: true }] } },
    ]);
    const { GET } = await import("@/app/api/teacher/permissions/route");
    const res = await GET(getReq("http://localhost/api/teacher/permissions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasCustomRole).toBe(true);
    expect(body.permissions).toEqual(expect.arrayContaining([{ module: "ANNOUNCEMENTS", action: "CREATE" }]));
    expect(body.permissions).not.toEqual(expect.arrayContaining([{ module: "ANNOUNCEMENTS", action: "VIEW" }]));
  });
});
