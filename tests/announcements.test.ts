import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    announcement: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    announcementTarget: { deleteMany: vi.fn() },
    announcementAudience: { deleteMany: vi.fn() },
    announcementRead: { upsert: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    teacher: { findFirst: vi.fn(), count: vi.fn() },
    section: { findMany: vi.fn() },
    student: { count: vi.fn() },
    guardian: { count: vi.fn() },
    studentGuardian: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  announcementInputSchema,
  correctionSchema,
  createAnnouncement,
  updateDraftOrScheduled,
  publishAnnouncement,
  correctPublishedAnnouncement,
  cancelAnnouncement,
  archiveAnnouncement,
  getTeacherAuthorizedSections,
  validateTargets,
  markAnnouncementRead,
  getAnnouncementStats,
  listAnnouncementsForStudent,
  listAnnouncementsForGuardian,
  listAnnouncementsForTeacher,
  transitionDueScheduledAnnouncements,
  AnnouncementAuthError,
} from "@/lib/announcements";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  p.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(p));
});

const SCHOOL = "school1";

describe("announcementInputSchema — validation", () => {
  const base = {
    title: "Notice",
    body: "Body text",
    scope: "SCHOOL_WIDE" as const,
    audience: ["STUDENTS" as const],
    targets: [],
    publishNow: false,
  };

  it("accepts a valid school-wide draft", () => {
    expect(announcementInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty title", () => {
    const r = announcementInputSchema.safeParse({ ...base, title: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a title over the length bound", () => {
    const r = announcementInputSchema.safeParse({ ...base, title: "x".repeat(500) });
    expect(r.success).toBe(false);
  });

  it("rejects CLASS_SECTION scope with no targets", () => {
    const r = announcementInputSchema.safeParse({ ...base, scope: "CLASS_SECTION", targets: [] });
    expect(r.success).toBe(false);
  });

  it("rejects SCHOOL_WIDE scope with targets attached (contradictory)", () => {
    const r = announcementInputSchema.safeParse({ ...base, targets: [{ classId: "c1", sectionId: "s1" }] });
    expect(r.success).toBe(false);
  });

  it("rejects a scheduledAt in the past", () => {
    const r = announcementInputSchema.safeParse({ ...base, scheduledAt: new Date(Date.now() - 60_000).toISOString() });
    expect(r.success).toBe(false);
  });

  it("rejects an expiresAt before the scheduled/publish time", () => {
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const r = announcementInputSchema.safeParse({ ...base, scheduledAt, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect(r.success).toBe(false);
  });

  it("rejects zero audience groups", () => {
    const r = announcementInputSchema.safeParse({ ...base, audience: [] });
    expect(r.success).toBe(false);
  });

  it("rejects scheduling and publishing immediately at the same time", () => {
    const r = announcementInputSchema.safeParse({ ...base, scheduledAt: new Date(Date.now() + 60_000).toISOString(), publishNow: true });
    expect(r.success).toBe(false);
  });
});

describe("getTeacherAuthorizedSections", () => {
  it("returns the union of timetable-slot sections and mentor section", async () => {
    p.teacher.findFirst.mockResolvedValue({
      timetableSlots: [{ section: { id: "sec1", classId: "cls1" } }, { section: { id: "sec2", classId: "cls1" } }],
      mentorSection: { id: "sec3", classId: "cls2" },
    });
    const result = await getTeacherAuthorizedSections("t1", SCHOOL);
    expect(result.map((r) => r.sectionId).sort()).toEqual(["sec1", "sec2", "sec3"]);
  });

  it("returns empty when the teacher does not exist / is deleted", async () => {
    p.teacher.findFirst.mockResolvedValue(null);
    expect(await getTeacherAuthorizedSections("ghost", SCHOOL)).toEqual([]);
  });
});

describe("validateTargets — cross-school IDOR + authorization", () => {
  it("rejects a section that does not belong to the school", async () => {
    p.section.findMany.mockResolvedValue([]);
    const result = await validateTargets(SCHOOL, [{ classId: "c1", sectionId: "s1" }]);
    expect(result.ok).toBe(false);
  });

  it("recomputes classId from the section row rather than trusting the client", async () => {
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "REAL_CLASS" }]);
    const result = await validateTargets(SCHOOL, [{ classId: "CLIENT_SUPPLIED_WRONG", sectionId: "s1" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.targets[0].classId).toBe("REAL_CLASS");
  });

  it("rejects a section outside the teacher's authorized set", async () => {
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
    const result = await validateTargets(SCHOOL, [{ classId: "c1", sectionId: "s1" }], new Set(["s2"]));
    expect(result.ok).toBe(false);
  });

  it("allows a section inside the teacher's authorized set", async () => {
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
    const result = await validateTargets(SCHOOL, [{ classId: "c1", sectionId: "s1" }], new Set(["s1"]));
    expect(result.ok).toBe(true);
  });
});

const teacherCtx = { actorKind: "TEACHER" as const, userId: "teacherUser1", teacherId: "teacher1", schoolId: SCHOOL };
const leadershipCtx = { actorKind: "LEADERSHIP" as const, userId: "admin1", role: "SCHOOL_ADMIN" as const, schoolId: SCHOOL };

const validInput = {
  title: "Class notice",
  body: "Details",
  scope: "CLASS_SECTION" as const,
  audience: ["STUDENTS" as const, "GUARDIANS" as const],
  targets: [{ classId: "c1", sectionId: "s1" }],
  publishNow: false,
};

describe("createAnnouncement — teacher authorization", () => {
  it("allows a teacher to target a class/section they are authorized for", async () => {
    p.teacher.findFirst.mockResolvedValue({ timetableSlots: [{ section: { id: "s1", classId: "c1" } }], mentorSection: null });
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });

    await createAnnouncement(teacherCtx, validInput);
    expect(p.announcement.create).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ANNOUNCEMENT_CREATED", schoolId: SCHOOL }));
  });

  it("rejects a teacher targeting a class/section they are not authorized for", async () => {
    p.teacher.findFirst.mockResolvedValue({ timetableSlots: [{ section: { id: "OTHER", classId: "c9" } }], mentorSection: null });
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);

    await expect(createAnnouncement(teacherCtx, validInput)).rejects.toBeInstanceOf(AnnouncementAuthError);
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("rejects a teacher attempting to publish a school-wide announcement", async () => {
    const schoolWide = { ...validInput, scope: "SCHOOL_WIDE" as const, targets: [] };
    await expect(createAnnouncement(teacherCtx, schoolWide)).rejects.toBeInstanceOf(AnnouncementAuthError);
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("rejects a teacher targeting the TEACHERS audience group", async () => {
    p.teacher.findFirst.mockResolvedValue({ timetableSlots: [{ section: { id: "s1", classId: "c1" } }], mentorSection: null });
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
    const withTeachers = { ...validInput, audience: ["TEACHERS" as const] };
    await expect(createAnnouncement(teacherCtx, withTeachers)).rejects.toBeInstanceOf(AnnouncementAuthError);
  });

  it("rejects a client-supplied schoolId/creator claim outright at the real route validation boundary (.strict() — never silently stripped)", async () => {
    // Simulate the untyped JSON body an API route receives (req.json() is
    // `any`/`unknown`, so a malicious client can freely add extra fields).
    // Route handlers parse it through announcementInputSchema before it ever
    // reaches createAnnouncement — that parse is the actual security
    // boundary. announcementInputSchema is `.strict()`, so an extra
    // schoolId/createdById must be REJECTED (400 at the route), not silently
    // stripped-and-ignored — a silent strip would still be safe today (every
    // route resolves identity from teacherAuth/session, never from `data`),
    // but it hides a malformed/malicious payload instead of surfacing it.
    const rawClientBody: unknown = JSON.parse(JSON.stringify({ ...validInput, schoolId: "OTHER_SCHOOL", createdById: "someoneElse" }));
    const result = announcementInputSchema.safeParse(rawClientBody);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("unrecognized_keys");
      expect(result.error.issues[0].message).toContain("schoolId");
      expect(result.error.issues[0].message).toContain("createdById");
    }
    expect(p.announcement.create).not.toHaveBeenCalled();
  });

  it("still accepts the identical payload once the extra fields are removed (proves the rejection above is about the extra keys, not the rest of the body)", async () => {
    p.teacher.findFirst.mockResolvedValue({ timetableSlots: [{ section: { id: "s1", classId: "c1" } }], mentorSection: null });
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
    p.announcement.create.mockResolvedValue({ id: "a1", audience: [], targets: [] });

    const parsed = announcementInputSchema.parse(validInput);
    await createAnnouncement(teacherCtx, parsed);
    const createCall = p.announcement.create.mock.calls[0][0];
    expect(createCall.data.schoolId).toBe(SCHOOL);
    expect(createCall.data.createdById).toBe("teacherUser1");
  });
});

describe("createAnnouncement — leadership", () => {
  it("allows a school-wide Teachers+Parents announcement", async () => {
    p.announcement.create.mockResolvedValue({ id: "a2", audience: [], targets: [] });
    const input = { title: "Staff notice", body: "Body", scope: "SCHOOL_WIDE" as const, audience: ["TEACHERS" as const, "GUARDIANS" as const], targets: [], publishNow: true };
    await createAnnouncement(leadershipCtx, input);
    const call = p.announcement.create.mock.calls[0][0];
    expect(call.data.scope).toBe("SCHOOL_WIDE");
    expect(call.data.status).toBe("PUBLISHED");
  });

  it("allows a class-targeted leadership announcement", async () => {
    p.section.findMany.mockResolvedValue([{ id: "s1", classId: "c1" }]);
    p.announcement.create.mockResolvedValue({ id: "a3", audience: [], targets: [] });
    await createAnnouncement(leadershipCtx, validInput);
    expect(p.announcement.create).toHaveBeenCalled();
  });

  it("rejects an invalid target not belonging to the school (IDOR)", async () => {
    p.section.findMany.mockResolvedValue([]);
    await expect(createAnnouncement(leadershipCtx, validInput)).rejects.toBeInstanceOf(AnnouncementAuthError);
  });
});

describe("updateDraftOrScheduled — ownership + tenant isolation", () => {
  it("returns 404 for an announcement belonging to a different school (IDOR)", async () => {
    p.announcement.findFirst.mockResolvedValue(null);
    await expect(updateDraftOrScheduled(leadershipCtx, "a1", validInput)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a teacher editing another teacher's draft", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: SCHOOL, status: "DRAFT", createdById: "someoneElse" });
    await expect(updateDraftOrScheduled(teacherCtx, "a1", validInput)).rejects.toBeInstanceOf(AnnouncementAuthError);
  });

  it("rejects editing a PUBLISHED announcement through the regular update path", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: SCHOOL, status: "PUBLISHED", createdById: "admin1" });
    await expect(updateDraftOrScheduled(leadershipCtx, "a1", validInput)).rejects.toMatchObject({ status: 409 });
  });
});

describe("publishAnnouncement / cancelAnnouncement / archiveAnnouncement", () => {
  it("publishes a draft and stamps publishedAt/publishedById", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: SCHOOL, status: "DRAFT", createdById: "admin1" });
    p.announcement.update.mockResolvedValue({ id: "a1", title: "t" });
    await publishAnnouncement(leadershipCtx, "a1");
    const call = p.announcement.update.mock.calls[0][0];
    expect(call.data.status).toBe("PUBLISHED");
    expect(call.data.publishedById).toBe("admin1");
  });

  it("cancels a published announcement and writes an audit entry", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: SCHOOL, status: "PUBLISHED", createdById: "admin1" });
    p.announcement.update.mockResolvedValue({ id: "a1", title: "t" });
    await cancelAnnouncement(leadershipCtx, "a1");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ANNOUNCEMENT_CANCELLED" }));
  });

  it("rejects archiving an already-archived announcement", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: SCHOOL, status: "ARCHIVED", createdById: "admin1" });
    await expect(archiveAnnouncement(leadershipCtx, "a1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("correctPublishedAnnouncement — published-correction audit behavior", () => {
  it("increments correctionCount and writes a before/after audit entry, never a raw overwrite", async () => {
    p.announcement.findFirst.mockResolvedValue({
      id: "a1",
      schoolId: SCHOOL,
      status: "PUBLISHED",
      createdById: "admin1",
      title: "Old title",
      body: "Old body",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: null,
    });
    p.announcement.update.mockResolvedValue({ id: "a1", title: "New title", body: "New body", correctionCount: 1, expiresAt: null });

    const result = correctionSchema.safeParse({ title: "New title", body: "New body" });
    expect(result.success).toBe(true);
    await correctPublishedAnnouncement(leadershipCtx, "a1", { title: "New title", body: "New body" });

    const updateCall = p.announcement.update.mock.calls[0][0];
    expect(updateCall.data.correctionCount).toEqual({ increment: 1 });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ANNOUNCEMENT_CORRECTED",
        metadata: expect.objectContaining({
          before: expect.objectContaining({ title: "Old title", body: "Old body" }),
          after: expect.objectContaining({ title: "New title", body: "New body" }),
        }),
      })
    );
  });

  it("rejects correcting a non-PUBLISHED announcement", async () => {
    p.announcement.findFirst.mockResolvedValue({ id: "a1", schoolId: SCHOOL, status: "DRAFT", createdById: "admin1" });
    await expect(correctPublishedAnnouncement(leadershipCtx, "a1", { title: "x", body: "y" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("transitionDueScheduledAnnouncements", () => {
  it("flips only SCHEDULED announcements whose scheduledAt has passed", async () => {
    p.announcement.findMany.mockResolvedValue([{ id: "a1", schoolId: SCHOOL, createdById: "admin1", createdByRole: "SCHOOL_ADMIN", title: "t" }]);
    p.announcement.update.mockResolvedValue({});
    const count = await transitionDueScheduledAnnouncements(SCHOOL);
    expect(count).toBe(1);
    const query = p.announcement.findMany.mock.calls[0][0];
    expect(query.where.status).toBe("SCHEDULED");
    expect(query.where.scheduledAt).toHaveProperty("lte");
    expect(p.announcement.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED" }) }));
  });
});

describe("recipient eligibility — students", () => {
  it("only queries PUBLISHED, non-expired, STUDENTS-audience announcements for the student's own section or school-wide", async () => {
    p.announcement.findMany.mockResolvedValue([]);
    p.announcement.count.mockResolvedValue(0);
    p.announcementRead.findMany.mockResolvedValue([]);
    await listAnnouncementsForStudent(SCHOOL, "student1", "sec1", { page: 1, limit: 50, skip: 0, take: 50 });
    const where = p.announcement.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("PUBLISHED");
    expect(where.audience.some.group).toBe("STUDENTS");
    expect(JSON.stringify(where.AND)).toContain("sec1");
  });

  it("marks isRead using only the student's own actorId", async () => {
    p.announcement.findMany.mockResolvedValue([{ id: "a1" }]);
    p.announcement.count.mockResolvedValue(1);
    p.announcementRead.findMany.mockResolvedValue([{ announcementId: "a1" }]);
    const result = await listAnnouncementsForStudent(SCHOOL, "student1", "sec1", { page: 1, limit: 50, skip: 0, take: 50 });
    expect(p.announcementRead.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ actorType: "STUDENT", actorId: "student1" }) }));
    expect(result.data[0].isRead).toBe(true);
  });
});

describe("recipient eligibility — guardians (parents)", () => {
  it("returns no announcements when the guardian has no linked students", async () => {
    p.studentGuardian.findMany.mockResolvedValue([]);
    const result = await listAnnouncementsForGuardian(SCHOOL, "g1", { page: 1, limit: 50, skip: 0, take: 50 });
    expect(result.data).toEqual([]);
  });

  it("dedupes an announcement relevant via multiple linked students and lists which students made it relevant", async () => {
    p.studentGuardian.findMany.mockResolvedValue([
      { student: { id: "stu1", name: "Alice", sectionId: "secA", section: { name: "A", class: { name: "5" } } } },
      { student: { id: "stu2", name: "Bob", sectionId: "secB", section: { name: "B", class: { name: "5" } } } },
    ]);
    p.announcement.findMany.mockResolvedValue([
      { id: "a1", scope: "SCHOOL_WIDE", targets: [] },
    ]);
    p.announcement.count.mockResolvedValue(1);
    p.announcementRead.findMany.mockResolvedValue([]);

    const result = await listAnnouncementsForGuardian(SCHOOL, "g1", { page: 1, limit: 50, skip: 0, take: 50 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].relevantStudents.map((s: { id: string }) => s.id).sort()).toEqual(["stu1", "stu2"]);
  });

  it("only shows the relevant student(s) for a class-targeted announcement", async () => {
    p.studentGuardian.findMany.mockResolvedValue([
      { student: { id: "stu1", name: "Alice", sectionId: "secA", section: { name: "A", class: { name: "5" } } } },
      { student: { id: "stu2", name: "Bob", sectionId: "secB", section: { name: "B", class: { name: "5" } } } },
    ]);
    p.announcement.findMany.mockResolvedValue([
      { id: "a1", scope: "CLASS_SECTION", targets: [{ sectionId: "secA" }] },
    ]);
    p.announcement.count.mockResolvedValue(1);
    p.announcementRead.findMany.mockResolvedValue([]);

    const result = await listAnnouncementsForGuardian(SCHOOL, "g1", { page: 1, limit: 50, skip: 0, take: 50 });
    expect(result.data[0].relevantStudents.map((s: { id: string }) => s.id)).toEqual(["stu1"]);
  });
});

describe("recipient eligibility — teachers", () => {
  it("lists school-wide TEACHERS-audience announcements plus the teacher's own", async () => {
    p.announcement.findMany.mockResolvedValue([]);
    p.announcement.count.mockResolvedValue(0);
    p.announcementRead.findMany.mockResolvedValue([]);
    await listAnnouncementsForTeacher(SCHOOL, "teacher1", "teacherUser1", { page: 1, limit: 50, skip: 0, take: 50 });
    const where = p.announcement.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("TEACHERS");
    expect(JSON.stringify(where)).toContain("teacherUser1");
  });
});

describe("markAnnouncementRead — idempotency + authorization", () => {
  it("upserts on (announcementId, actorType, actorId) — idempotent", async () => {
    p.announcement.findFirst.mockResolvedValue({
      id: "a1",
      audience: [{ group: "STUDENTS" }],
      targets: [],
      scope: "SCHOOL_WIDE",
      createdById: "x",
    });
    p.announcementRead.upsert.mockResolvedValue({});
    await markAnnouncementRead(SCHOOL, "a1", { actorType: "STUDENT", actorId: "student1", sectionId: "sec1" });
    expect(p.announcementRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { announcementId_actorType_actorId: { announcementId: "a1", actorType: "STUDENT", actorId: "student1" } },
      })
    );
  });

  it("rejects marking read for a non-recipient (audience mismatch)", async () => {
    p.announcement.findFirst.mockResolvedValue({
      id: "a1",
      audience: [{ group: "TEACHERS" }],
      targets: [],
      scope: "SCHOOL_WIDE",
      createdById: "otherUser",
    });
    await expect(
      markAnnouncementRead(SCHOOL, "a1", { actorType: "STUDENT", actorId: "student1", sectionId: "sec1" })
    ).rejects.toMatchObject({ status: 403 });
    expect(p.announcementRead.upsert).not.toHaveBeenCalled();
  });

  it("rejects marking read for a section-targeted announcement outside the student's own section", async () => {
    p.announcement.findFirst.mockResolvedValue({
      id: "a1",
      audience: [{ group: "STUDENTS" }],
      targets: [{ sectionId: "secOTHER" }],
      scope: "CLASS_SECTION",
      createdById: "x",
    });
    await expect(
      markAnnouncementRead(SCHOOL, "a1", { actorType: "STUDENT", actorId: "student1", sectionId: "secMINE" })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects marking read for an announcement not visible now (cross-school / not found)", async () => {
    p.announcement.findFirst.mockResolvedValue(null);
    await expect(
      markAnnouncementRead(SCHOOL, "a1", { actorType: "STUDENT", actorId: "student1", sectionId: "sec1" })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("getAnnouncementStats — bounded aggregate only, no per-recipient PII", () => {
  it("returns eligible/read counts per audience group without any recipient identifiers", async () => {
    p.announcement.findFirst.mockResolvedValue({
      id: "a1",
      schoolId: SCHOOL,
      scope: "CLASS_SECTION",
      audience: [{ group: "STUDENTS" }, { group: "GUARDIANS" }],
      targets: [{ sectionId: "sec1" }],
    });
    p.student.count.mockResolvedValue(30);
    p.announcementRead.count.mockResolvedValueOnce(10); // STUDENTS read
    p.guardian.count.mockResolvedValue(25);
    p.announcementRead.count.mockResolvedValueOnce(5); // GUARDIANS read

    const stats = await getAnnouncementStats(SCHOOL, "a1");
    expect(stats).toEqual({ STUDENTS: { eligible: 30, read: 10 }, GUARDIANS: { eligible: 25, read: 5 } });
    expect(JSON.stringify(stats)).not.toMatch(/stu\d|guardianId|name/i);
  });

  it("throws 404 for an announcement outside the caller's school (IDOR)", async () => {
    p.announcement.findFirst.mockResolvedValue(null);
    await expect(getAnnouncementStats(SCHOOL, "a1")).rejects.toMatchObject({ status: 404 });
  });
});
