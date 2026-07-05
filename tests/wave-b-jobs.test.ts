import { describe, it, expect, afterEach } from "vitest";
import {
  reportCardBatchPayloadSchema,
  studentBulkImportPayloadSchema,
  smartTimetableGenerationPayloadSchema,
  JOB_TYPE_FEATURE,
  REPORT_CARD_SYNC_LIMIT,
  STUDENT_BULK_IMPORT_SYNC_LIMIT,
  SMART_TIMETABLE_SYNC_SECTION_LIMIT,
  JOB_LEASE_MS,
  isJobWorkerConfigured,
} from "@/lib/jobs";
import { getJobHandler } from "@/lib/job-handlers";

/**
 * These tests cover the parts of the job system that don't require a live
 * database: payload validation, the handler registry, feature gating, and
 * sync-threshold constants. Atomic-claim/concurrency behavior (claimNextJob's
 * compare-and-swap updateMany) is a Postgres-dependent integration concern —
 * this repo's test suite never connects to a real database (dev/test always
 * resolves to MemoryStorageProvider / no DB calls), so that behavior is
 * verified by code review of the compare-and-swap pattern in src/lib/jobs.ts
 * rather than by an automated test here.
 */

describe("job payload validation — never trusts a DB Json blob without re-validation", () => {
  it("accepts a valid REPORT_CARD_BATCH_GENERATION payload", () => {
    const result = reportCardBatchPayloadSchema.safeParse({
      schoolId: "s1",
      teacherId: "t1",
      sectionId: "sec1",
      examSchemeId: "ex1",
      studentIds: ["stu1", "stu2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a REPORT_CARD_BATCH_GENERATION payload with an empty studentIds array", () => {
    const result = reportCardBatchPayloadSchema.safeParse({
      schoolId: "s1",
      teacherId: "t1",
      sectionId: "sec1",
      examSchemeId: "ex1",
      studentIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a REPORT_CARD_BATCH_GENERATION payload missing required fields", () => {
    const result = reportCardBatchPayloadSchema.safeParse({ schoolId: "s1" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid STUDENT_BULK_IMPORT payload", () => {
    const result = studentBulkImportPayloadSchema.safeParse({
      schoolId: "s1",
      createdById: "u1",
      storedFileId: "file1",
      rowCount: 500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a STUDENT_BULK_IMPORT payload with a negative rowCount", () => {
    const result = studentBulkImportPayloadSchema.safeParse({
      schoolId: "s1",
      createdById: "u1",
      storedFileId: "file1",
      rowCount: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an arbitrary/malicious payload shape", () => {
    const result = reportCardBatchPayloadSchema.safeParse({ __proto__: { polluted: true } });
    expect(result.success).toBe(false);
  });

  it("accepts a valid SMART_TIMETABLE_GENERATION payload", () => {
    const result = smartTimetableGenerationPayloadSchema.safeParse({
      schoolId: "s1",
      createdById: "u1",
      sections: [
        { classId: "c1", sectionId: "sec-a" },
        { classId: "c1", sectionId: "sec-b", completionMode: "REOPTIMIZE_UNLOCKED" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a SMART_TIMETABLE_GENERATION payload with an empty sections array", () => {
    const result = smartTimetableGenerationPayloadSchema.safeParse({ schoolId: "s1", createdById: "u1", sections: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a SMART_TIMETABLE_GENERATION payload with an invalid completionMode", () => {
    const result = smartTimetableGenerationPayloadSchema.safeParse({
      schoolId: "s1",
      createdById: "u1",
      sections: [{ classId: "c1", sectionId: "sec-a", completionMode: "NOT_A_MODE" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("job type → feature gate mapping", () => {
  it("gates REPORT_CARD_BATCH_GENERATION behind REPORT_CARDS", () => {
    expect(JOB_TYPE_FEATURE.REPORT_CARD_BATCH_GENERATION).toBe("REPORT_CARDS");
  });

  it("does not gate STUDENT_BULK_IMPORT behind any catalog feature", () => {
    expect(JOB_TYPE_FEATURE.STUDENT_BULK_IMPORT).toBeNull();
  });

  it("does not gate SMART_TIMETABLE_GENERATION behind any catalog feature", () => {
    expect(JOB_TYPE_FEATURE.SMART_TIMETABLE_GENERATION).toBeNull();
  });
});

describe("job handler registry", () => {
  it("resolves a handler for every known job type", () => {
    expect(getJobHandler("REPORT_CARD_BATCH_GENERATION")).toBeTypeOf("function");
    expect(getJobHandler("STUDENT_BULK_IMPORT")).toBeTypeOf("function");
    expect(getJobHandler("SMART_TIMETABLE_GENERATION")).toBeTypeOf("function");
  });

  it("safely returns null (never throws) for an unknown job type", () => {
    expect(getJobHandler("NOT_A_REAL_JOB_TYPE")).toBeNull();
    expect(getJobHandler("")).toBeNull();
  });
});

describe("sync thresholds and lease configuration", () => {
  it("uses a bounded synchronous threshold for report-card batches", () => {
    expect(REPORT_CARD_SYNC_LIMIT).toBe(40);
  });

  it("uses a bounded synchronous threshold for smart timetable generation (single section only)", () => {
    expect(SMART_TIMETABLE_SYNC_SECTION_LIMIT).toBe(1);
  });

  it("uses a bounded synchronous threshold for student bulk import", () => {
    expect(STUDENT_BULK_IMPORT_SYNC_LIMIT).toBe(100);
  });

  it("uses a positive, finite job lease window for crash recovery", () => {
    expect(JOB_LEASE_MS).toBeGreaterThan(0);
    expect(Number.isFinite(JOB_LEASE_MS)).toBe(true);
  });
});

describe("job worker readiness", () => {
  const originalSecret = process.env.JOB_WORKER_SECRET;
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JOB_WORKER_SECRET;
    else process.env.JOB_WORKER_SECRET = originalSecret;
  });

  it("reports not configured when JOB_WORKER_SECRET is unset", () => {
    delete process.env.JOB_WORKER_SECRET;
    expect(isJobWorkerConfigured()).toBe(false);
  });

  it("reports configured when JOB_WORKER_SECRET is set", () => {
    process.env.JOB_WORKER_SECRET = "test-secret";
    expect(isJobWorkerConfigured()).toBe(true);
  });
});
