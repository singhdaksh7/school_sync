import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bcryptjs", () => ({ default: { compare: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    authSession: { updateMany: vi.fn() },
    schoolDeletionAudit: { create: vi.fn() },
    student: { count: vi.fn().mockResolvedValue(0) },
    guardian: { count: vi.fn().mockResolvedValue(0) },
    teacher: { count: vi.fn().mockResolvedValue(0) },
    class: { count: vi.fn().mockResolvedValue(0) },
    homework: { count: vi.fn().mockResolvedValue(0) },
    examResult: { count: vi.fn().mockResolvedValue(0) },
    feePayment: { count: vi.fn().mockResolvedValue(0) },
    schoolInvite: { count: vi.fn().mockResolvedValue(0) },
    storedFile: { count: vi.fn().mockResolvedValue(0) },
    backgroundJob: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/jobs", () => ({ createJob: vi.fn() }));

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { scheduleSchoolDeletion, cancelSchoolDeletion, ensureDueSchoolPurgeJobs } from "@/lib/school-deletion";
import { createJob } from "@/lib/jobs";

const p = prisma as unknown as {
  school: { findUnique: ReturnType<typeof vi.fn>; findUniqueOrThrow: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  authSession: { updateMany: ReturnType<typeof vi.fn> };
  schoolDeletionAudit: { create: ReturnType<typeof vi.fn> };
  backgroundJob: { count: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const school = { id: "school1", name: "Greenwood High", slug: "greenwood-high", status: "ACTIVE" };

beforeEach(() => {
  vi.clearAllMocks();
  p.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("scheduleSchoolDeletion", () => {
  it("404s when the school doesn't exist", async () => {
    p.school.findUnique.mockResolvedValue(null);
    const result = await scheduleSchoolDeletion({ schoolId: "missing", founderId: "f1", password: "x", confirmedNameOrSlug: "x" });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("fails re-auth when the password doesn't match — schedules nothing", async () => {
    p.school.findUnique.mockResolvedValue(school);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });

    const result = await scheduleSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "wrong", confirmedNameOrSlug: "Greenwood High" });
    expect(result).toMatchObject({ ok: false, code: "REAUTH_FAILED" });
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it("fails when the typed confirmation doesn't match the school name or slug", async () => {
    p.school.findUnique.mockResolvedValue(school);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });

    const result = await scheduleSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "correct", confirmedNameOrSlug: "Wrong Name" });
    expect(result).toMatchObject({ ok: false, code: "CONFIRMATION_MISMATCH" });
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it("accepts the slug as an equally valid confirmation, not just the exact name", async () => {
    p.school.findUnique.mockResolvedValue(school);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });

    const result = await scheduleSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "correct", confirmedNameOrSlug: "greenwood-high" });
    expect(result.ok).toBe(true);
  });

  it("refuses to schedule a school that's already in a deletion-lifecycle state", async () => {
    p.school.findUnique.mockResolvedValue({ ...school, status: "PENDING_DELETION" });
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });

    const result = await scheduleSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "correct", confirmedNameOrSlug: "Greenwood High" });
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("on success: sets PENDING_DELETION, revokes active sessions, and writes a minimal non-PII audit row", async () => {
    p.school.findUnique.mockResolvedValue(school);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });
    const updatedSchool = { ...school, status: "PENDING_DELETION" };
    p.school.update.mockResolvedValue(updatedSchool);
    p.authSession.updateMany.mockResolvedValue({ count: 2 });
    p.schoolDeletionAudit.create.mockResolvedValue({});

    const result = await scheduleSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "correct", confirmedNameOrSlug: "Greenwood High" });

    expect(result).toMatchObject({ ok: true });
    expect(p.school.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_DELETION", preDeletionStatus: "ACTIVE" }) })
    );
    expect(p.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school1", revokedAt: null } })
    );
    const auditCall = p.schoolDeletionAudit.create.mock.calls[0][0].data;
    expect(auditCall).toMatchObject({ schoolId: "school1", actorId: "f1", action: "SCHEDULED" });
    // Minimal non-PII audit: only aggregate counts, never row contents/names.
    expect(Object.keys(auditCall)).toEqual(expect.arrayContaining(["schoolId", "actorId", "action", "status", "counts"]));
    expect(JSON.stringify(auditCall)).not.toMatch(/@/); // no email addresses leaked into the audit
  });
});

describe("cancelSchoolDeletion", () => {
  it("fails re-auth when the password doesn't match", async () => {
    p.school.findUnique.mockResolvedValue({ ...school, status: "PENDING_DELETION" });
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });

    const result = await cancelSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "wrong" });
    expect(result).toMatchObject({ ok: false, code: "REAUTH_FAILED" });
    expect(p.school.updateMany).not.toHaveBeenCalled();
  });

  it("restores to the pre-deletion status on success", async () => {
    p.school.findUnique.mockResolvedValue({ ...school, status: "PENDING_DELETION", preDeletionStatus: "SUSPENDED" });
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });
    p.school.updateMany.mockResolvedValue({ count: 1 });
    p.school.findUniqueOrThrow.mockResolvedValue({ ...school, status: "SUSPENDED" });

    const result = await cancelSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "correct" });
    expect(result.ok).toBe(true);
    expect(p.school.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "school1", status: "PENDING_DELETION" },
        data: expect.objectContaining({ status: "SUSPENDED" }),
      })
    );
  });

  it("concurrency: refuses to cancel once the purge has already claimed the school (CAS returns 0 rows)", async () => {
    p.school.findUnique.mockResolvedValue({ ...school, status: "PENDING_DELETION" });
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    p.user.findUnique.mockResolvedValue({ password: "hashed" });
    p.school.updateMany.mockResolvedValue({ count: 0 }); // purge job's CAS won the race first

    const result = await cancelSchoolDeletion({ schoolId: "school1", founderId: "f1", password: "correct" });
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});

describe("ensureDueSchoolPurgeJobs — maintenance trigger", () => {
  it("finds PENDING_DELETION schools past their retention window AND DELETION_FAILED schools (auto-retry)", async () => {
    p.school.findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    p.backgroundJob.findFirst.mockResolvedValue(null);
    vi.mocked(createJob).mockResolvedValue({ ok: true, job: { id: "job1" } } as never);

    const result = await ensureDueSchoolPurgeJobs();
    expect(result.schoolIds).toEqual(["s1", "s2"]);
    expect(createJob).toHaveBeenCalledTimes(2);

    const whereArg = p.school.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(whereArg)).toContain("DELETION_FAILED");
    expect(JSON.stringify(whereArg)).toContain("PENDING_DELETION");
  });

  it("never creates a second active purge job for a school that already has one (idempotent trigger)", async () => {
    p.school.findMany.mockResolvedValue([{ id: "s1" }]);
    p.backgroundJob.findFirst.mockResolvedValue({ id: "existing-job" });

    const result = await ensureDueSchoolPurgeJobs();
    expect(result.created).toBe(0);
    expect(result.reused).toBe(1);
    expect(createJob).not.toHaveBeenCalled();
  });
});
