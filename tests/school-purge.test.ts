import { describe, it, expect, vi, beforeEach } from "vitest";

function emptyThenBatch(batch: Record<string, unknown>[][]) {
  const fn = vi.fn();
  for (const b of batch) fn.mockResolvedValueOnce(b);
  fn.mockResolvedValue([]);
  return fn;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    homeworkSubmission: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    examResult: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    reportCard: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    feePayment: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    attendance: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    studentGuardian: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    homework: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    feeStructure: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    examScheme: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    timetableSlot: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    storedFile: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    student: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    guardian: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    teacher: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    subject: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    section: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    class: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    schoolInvite: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    backgroundJob: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
    schoolSubscription: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    school: { updateMany: vi.fn(), delete: vi.fn() },
    schoolDeletionAudit: { create: vi.fn() },
  },
}));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, getStorageProvider: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { getStorageProvider, StorageError } from "@/lib/storage";
import { purgeSchoolData } from "@/lib/school-purge";
import { getJobHandler } from "@/lib/job-handlers";

const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const noopProgress = { onBatch: vi.fn(async () => {}) };

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish default empty resolutions cleared by clearAllMocks.
  for (const model of Object.values(p)) {
    if (model.findMany) model.findMany.mockResolvedValue([]);
  }
  p.schoolSubscription.deleteMany.mockResolvedValue({ count: 1 });
  p.user.findMany.mockResolvedValue([]);
  p.user.update.mockResolvedValue({});
  p.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
  vi.mocked(getStorageProvider).mockImplementation(() => {
    throw new StorageError("NOT_CONFIGURED", "Storage not configured");
  });
});

describe("purgeSchoolData — identity rule (never delete a User row, never leave PII behind)", () => {
  it("irreversibly anonymizes every direct school-admin/owner User account — never a bare schoolId:null", async () => {
    p.user.findMany.mockResolvedValueOnce([{ id: "admin1" }, { id: "admin2" }]).mockResolvedValue([]);

    const counts = await purgeSchoolData("school1", noopProgress);

    expect(p.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school1" } })
    );
    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: "admin1" },
      data: expect.objectContaining({ name: "Deleted User", email: expect.stringContaining("purged.invalid"), schoolId: null }),
    });
    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: "admin2" },
      data: expect.objectContaining({ name: "Deleted User", email: expect.stringContaining("purged.invalid"), schoolId: null }),
    });
    // The old password hash is never left in place — a fresh random value is written.
    const call = p.user.update.mock.calls.find((c) => c[0].where.id === "admin1")!;
    expect(call[0].data.password).toEqual(expect.any(String));
    expect(p.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "admin1" } });
    expect(p.user.delete).not.toHaveBeenCalled();
    expect(p.user.deleteMany).not.toHaveBeenCalled();
    expect(counts.schoolAdminUserAccountsAnonymized).toBe(2);
  });

  it("anonymizes Teacher-linked login accounts (User.schoolId not set) BEFORE the Teacher rows are deleted", async () => {
    const callOrder: string[] = [];
    let teacherLinkedCalls = 0;
    let teacherDeleteFindCalls = 0;
    p.teacher.findMany.mockImplementation(async (args: { select?: { userId?: boolean; id?: boolean } }) => {
      if (args.select?.userId) {
        teacherLinkedCalls += 1;
        callOrder.push("findTeacherLinkedUsers");
        return teacherLinkedCalls === 1 ? [{ userId: "teacherUser1" }] : [];
      }
      teacherDeleteFindCalls += 1;
      callOrder.push("findTeachersForDelete");
      return teacherDeleteFindCalls === 1 ? [{ id: "teacher1" }] : [];
    });
    p.teacher.deleteMany.mockImplementation(async () => {
      callOrder.push("deleteTeachers");
      return { count: 0 };
    });
    p.user.update.mockImplementation(async () => {
      callOrder.push("anonymizeTeacherUser");
      return {};
    });

    const counts = await purgeSchoolData("school1", noopProgress);

    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: "teacherUser1" },
      data: expect.objectContaining({ name: "Deleted User", schoolId: null }),
    });
    expect(callOrder.indexOf("anonymizeTeacherUser")).toBeLessThan(callOrder.indexOf("deleteTeachers"));
    expect(counts.teacherUserAccountsAnonymized).toBe(1);
  });
});

describe("purgeSchoolData — bounded batching and self-scoping to one school", () => {
  it("paginates a large table across multiple bounded batches until exhausted (idempotent: a re-run sees 0 remaining)", async () => {
    p.student.findMany = emptyThenBatch([
      Array.from({ length: 200 }, (_, i) => ({ id: `s${i}` })),
      Array.from({ length: 50 }, (_, i) => ({ id: `s2-${i}` })),
    ]);

    await purgeSchoolData("school1", noopProgress);

    // A full 200-row batch then a short 50-row batch — the short batch itself
    // signals "no more" so there's no extra round-trip to confirm empty.
    expect(p.student.findMany).toHaveBeenCalledTimes(2);
    expect(p.student.deleteMany).toHaveBeenCalledTimes(2);
    for (const call of p.student.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ schoolId: "school1" }); // never an unbounded/cross-school query
    }
  });
});

describe("purgeSchoolData — StoredFile / S3 isolation", () => {
  it("deletes only objects proven to belong to this school via the DB row's storageKey, never a bucket prefix scan", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getStorageProvider).mockReturnValue({ deleteObject } as never);
    p.storedFile.findMany = emptyThenBatch([[{ id: "f1", storageKey: "school1/f1.pdf" }]]);
    p.storedFile.deleteMany.mockResolvedValue({ count: 1 });

    const counts = await purgeSchoolData("school1", noopProgress);

    expect(deleteObject).toHaveBeenCalledWith("school1/f1.pdf");
    expect(p.storedFile.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["f1"] } } });
    expect(counts.storedFiles).toBe(1);
  });

  it("a transient S3 delete failure leaves that row alone for the next run — never marks it deleted without proof", async () => {
    const deleteObject = vi.fn().mockRejectedValue(new Error("network blip"));
    vi.mocked(getStorageProvider).mockReturnValue({ deleteObject } as never);
    p.storedFile.findMany.mockResolvedValueOnce([{ id: "f1", storageKey: "school1/f1.pdf" }]).mockResolvedValue([]);

    const counts = await purgeSchoolData("school1", noopProgress);

    expect(p.storedFile.deleteMany).not.toHaveBeenCalled();
    expect(counts.storedFiles).toBe(0);
  });

  it("falls back to metadata-only cleanup when no storage provider is configured (never fails the whole purge for it)", async () => {
    vi.mocked(getStorageProvider).mockImplementation(() => {
      throw new StorageError("NOT_CONFIGURED", "Storage not configured");
    });
    p.storedFile.findMany = emptyThenBatch([[{ id: "f1" }]]);
    p.storedFile.deleteMany.mockResolvedValue({ count: 1 });

    const counts = await purgeSchoolData("school1", noopProgress);
    expect(counts.storedFiles).toBe(1);
  });
});

describe("SCHOOL_DATA_PURGE job handler — concurrency / idempotency / audit", () => {
  it("is a clean no-op when the CAS claim finds the school already restored/purged (count 0) — never writes PURGE_STARTED", async () => {
    p.school.updateMany.mockResolvedValue({ count: 0 });
    const handler = getJobHandler("SCHOOL_DATA_PURGE")!;

    const result = await handler({ id: "job1", payload: { schoolId: "school1" }, createdById: null } as never, { updateProgress: vi.fn() });

    expect(result.resultMetadata).toMatchObject({ skipped: true });
    expect(p.schoolDeletionAudit.create).not.toHaveBeenCalled();
    expect(p.school.delete).not.toHaveBeenCalled();
  });

  it("on success: claims via CAS, deletes the School row LAST, and writes exactly a PURGE_STARTED then PURGE_COMPLETED audit with aggregate counts only", async () => {
    p.school.updateMany.mockResolvedValue({ count: 1 });
    p.school.delete.mockResolvedValue({});
    const handler = getJobHandler("SCHOOL_DATA_PURGE")!;

    const result = await handler({ id: "job1", payload: { schoolId: "school1" }, createdById: "founder1" } as never, { updateProgress: vi.fn() });

    expect(p.school.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "school1", status: { in: ["PENDING_DELETION", "DELETION_FAILED", "DELETING"] } }, data: { status: "DELETING" } })
    );
    const actions = p.schoolDeletionAudit.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(["PURGE_STARTED", "PURGE_COMPLETED"]);
    const completedAudit = p.schoolDeletionAudit.create.mock.calls[1][0].data;
    expect(JSON.stringify(completedAudit)).not.toMatch(/@/); // no emails/PII in the audit
    expect(p.school.delete).toHaveBeenCalledWith({ where: { id: "school1" } });
    expect(result.resultMetadata).toMatchObject({ schoolId: "school1" });
  });

  it("on failure: marks DELETION_FAILED with a sanitized+bounded error, increments retry count, writes PURGE_FAILED, and rethrows", async () => {
    p.school.updateMany.mockResolvedValue({ count: 1 });
    p.student.findMany.mockRejectedValueOnce(new Error("simulated DB failure with a very long message ".repeat(20)));
    const handler = getJobHandler("SCHOOL_DATA_PURGE")!;

    await expect(handler({ id: "job1", payload: { schoolId: "school1" }, createdById: null } as never, { updateProgress: vi.fn() })).rejects.toThrow();

    const failCall = p.school.updateMany.mock.calls.find((c) => c[0].data?.status === "DELETION_FAILED");
    expect(failCall).toBeTruthy();
    expect(failCall![0].data.deletionRetryCount).toEqual({ increment: 1 });
    expect(failCall![0].data.deletionLastError.length).toBeLessThanOrEqual(500);
    expect(p.school.delete).not.toHaveBeenCalled();
    const actions = p.schoolDeletionAudit.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain("PURGE_FAILED");
  });
});
