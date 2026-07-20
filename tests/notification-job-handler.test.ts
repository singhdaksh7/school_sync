import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { create: vi.fn() },
  },
}));
// job-handlers.ts imports several unrelated services at module scope — stub
// them out so importing the module doesn't pull in their own dependencies.
vi.mock("@/lib/report-cards", () => ({ buildReportCardBatchContext: vi.fn(), generateReportCardForStudent: vi.fn() }));
vi.mock("@/lib/student-import", () => ({ importStudentRows: vi.fn() }));
vi.mock("@/lib/plan-limits", () => ({ getStudentLimitInfo: vi.fn() }));
vi.mock("@/lib/file-service", () => ({ readManagedFileBytes: vi.fn() }));
vi.mock("@/lib/smart-timetable-batch", () => ({ generateSectionsBatch: vi.fn() }));
vi.mock("@/lib/file-retention", () => ({ studentImportSourceRetention: vi.fn() }));
vi.mock("@/lib/clock", () => ({ systemClock: { now: () => new Date() } }));
vi.mock("@/lib/cost-guard-policy", () => ({ FILE_RETENTION_CLEANUP_BATCH_SIZE: 100 }));
vi.mock("@/lib/storage", () => ({ getStorageProvider: vi.fn(), StorageError: class extends Error {} }));
vi.mock("@/lib/school-purge", () => ({ purgeSchoolData: vi.fn() }));
vi.mock("@/lib/invite-tokens", () => ({ generateInviteToken: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendStaffInviteEmail: vi.fn() }));
vi.mock("@/lib/jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jobs")>("@/lib/jobs");
  return { ...actual, claimSpecificJob: vi.fn(), completeJob: vi.fn(), failJob: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { getJobHandler } from "@/lib/job-handlers";

const p = prisma as unknown as { notification: { create: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.resetAllMocks();
});

const updateProgress = vi.fn(async () => {});

function fakeJob(payload: unknown) {
  return { id: "job1", payload } as never;
}

describe("NOTIFICATION_FANOUT job handler", () => {
  it("creates one notification per recipient using the payload's recipient list", async () => {
    p.notification.create.mockResolvedValue({ id: "n1" });
    const handler = getJobHandler("NOTIFICATION_FANOUT")!;
    const result = await handler(
      fakeJob({
        schoolId: "school-a",
        eventType: "ATTENDANCE_ABSENT",
        entityType: "AttendanceSession",
        entityId: "session-1",
        recipients: [
          { recipientType: "STUDENT", recipientId: "st1" },
          { recipientType: "GUARDIAN", recipientId: "g1" },
        ],
        metadata: {},
        versionKey: "",
      }),
      { updateProgress }
    );
    expect(p.notification.create).toHaveBeenCalledTimes(2);
    expect(result.processedItems).toBe(2);
    expect(result.failedItems).toBe(0);
    expect(result.resultMetadata).toMatchObject({ total: 2, created: 2, alreadyDelivered: 0, failed: 0 });
  });

  it("a duplicate-idempotency-key delivery (P2002) is counted as already-delivered, not a failure — retry-safe", async () => {
    p.notification.create.mockRejectedValue({ code: "P2002" });
    const handler = getJobHandler("NOTIFICATION_FANOUT")!;
    const result = await handler(
      fakeJob({
        schoolId: "school-a",
        eventType: "ATTENDANCE_ABSENT",
        entityType: "AttendanceSession",
        entityId: "session-1",
        recipients: [{ recipientType: "STUDENT", recipientId: "st1" }],
        metadata: {},
        versionKey: "",
      }),
      { updateProgress }
    );
    expect(result.failedItems).toBe(0);
    expect(result.resultMetadata).toMatchObject({ alreadyDelivered: 1, created: 0 });
  });

  it("a genuine (non-duplicate) delivery error counts as failed, not silently swallowed", async () => {
    p.notification.create.mockRejectedValue(new Error("db down"));
    const handler = getJobHandler("NOTIFICATION_FANOUT")!;
    const result = await handler(
      fakeJob({
        schoolId: "school-a",
        eventType: "ATTENDANCE_ABSENT",
        entityType: "AttendanceSession",
        entityId: "session-1",
        recipients: [{ recipientType: "STUDENT", recipientId: "st1" }],
        metadata: {},
        versionKey: "",
      }),
      { updateProgress }
    );
    expect(result.failedItems).toBe(1);
  });

  it("rejects a malformed payload (schema re-validated at processing time, never trusting the DB Json blob)", async () => {
    const handler = getJobHandler("NOTIFICATION_FANOUT")!;
    await expect(handler(fakeJob({ schoolId: "school-a" }), { updateProgress })).rejects.toThrow();
  });
});
