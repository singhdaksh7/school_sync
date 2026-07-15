/**
 * Typed job handler registry. Each handler re-validates the persisted payload
 * (never trusts the DB Json), reuses the SAME business logic as the synchronous
 * path (no duplicated report-card / import logic), reports progress, and returns
 * a BOUNDED result summary (never thousands of rows or documents).
 */

import { prisma } from "@/lib/prisma";
import type { BackgroundJob } from "@/generated/prisma/client";
import { reportCardBatchPayloadSchema, studentBulkImportPayloadSchema, smartTimetableGenerationPayloadSchema, fileRetentionCleanupPayloadSchema, schoolDataPurgePayloadSchema, inviteEmailDeliveryPayloadSchema, claimSpecificJob, completeJob, failJob } from "@/lib/jobs";
import { buildReportCardBatchContext, generateReportCardForStudent } from "@/lib/report-cards";
import { importStudentRows, type ImportRow } from "@/lib/student-import";
import { getStudentLimitInfo } from "@/lib/plan-limits";
import { readManagedFileBytes } from "@/lib/file-service";
import { generateSectionsBatch } from "@/lib/smart-timetable-batch";
import { studentImportSourceRetention } from "@/lib/file-retention";
import { systemClock } from "@/lib/clock";
import { FILE_RETENTION_CLEANUP_BATCH_SIZE } from "@/lib/cost-guard-policy";
import { getStorageProvider, StorageError } from "@/lib/storage";
import { purgeSchoolData } from "@/lib/school-purge";
import { generateInviteToken } from "@/lib/invite-tokens";
import { sendStaffInviteEmail } from "@/lib/email";

export type JobHelpers = {
  updateProgress: (processed: number, failed: number) => Promise<void>;
};

export type JobResult = {
  processedItems: number;
  failedItems: number;
  resultMetadata: Record<string, unknown>;
};

export type JobHandler = (job: BackgroundJob, helpers: JobHelpers) => Promise<JobResult>;

/**
 * IAM note: this file calls sendStaffInviteEmail (see the INVITE_EMAIL_DELIVERY
 * handler below). That is safe here specifically because job-handlers.ts is
 * ONLY ever executed inside the "web" ECS task's process — invoked via
 * src/app/api/internal/worker/route.ts (part of the Next.js app the "web"
 * service serves) or inline from another src/app route handler — never inside
 * the standalone scripts/worker.ts poller, which has no Next.js/app imports
 * at all and runs under the SES-permission-less "minimal" task role (see
 * tests/email-iam-mapping.test.ts, which encodes and checks this exact
 * boundary, including an explicit exception for this file).
 */
function resolveInviteBaseUrl(req?: Request): string {
  const configuredBaseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  if (configuredBaseUrl) return configuredBaseUrl;
  return req ? new URL(req.url).origin : "";
}

/**
 * Core delivery step for the Founder "Add School" admin invite outbox
 * (INVITE_EMAIL_DELIVERY — see src/lib/jobs.ts and
 * src/lib/school-onboarding.ts, which creates the durable job row in the
 * SAME transaction as the SchoolInvite). Only the invite's id is ever
 * persisted in the job payload/result — the raw token is minted here, at
 * send time, and handed back to the immediate in-process caller only; it is
 * NEVER written to the job row, logged, or otherwise persisted, matching
 * SchoolInvite.tokenHash's existing "hash only, never the raw token" rule
 * (src/lib/invite-tokens.ts).
 *
 * Deliberately re-mints the token on every run rather than trying to recover
 * the original: since only the hash is ever stored, there is nothing to
 * "resume" across a crash — every successful run is simply a fresh, valid
 * capability. If a crash happens in the narrow window after a successful
 * send but before the caller records job completion, a retry can send one
 * additional (still valid, still bounded — not unbounded) email with a new
 * link; the previous link keeps working too until either is redeemed or
 * expires. This is an accepted at-least-once trade-off for an external side
 * effect that cannot be part of the same DB transaction.
 */
async function deliverInviteEmailNow(inviteId: string, req?: Request): Promise<{ delivered: boolean; rawToken?: string; reason?: string }> {
  const invite = await prisma.schoolInvite.findUnique({
    where: { id: inviteId },
    include: { school: { select: { name: true } } },
  });
  if (!invite) return { delivered: false, reason: "invite not found (cancelled or already purged)" };
  if (invite.usedAt) return { delivered: false, reason: "invite already accepted" };
  if (invite.expiresAt.getTime() < Date.now()) return { delivered: false, reason: "invite expired" };

  const { rawToken, tokenHash } = generateInviteToken();
  await prisma.schoolInvite.update({ where: { id: invite.id }, data: { tokenHash } });

  const inviteLink = `${resolveInviteBaseUrl(req)}/invite/${rawToken}`;
  await sendStaffInviteEmail(invite.email, {
    name: invite.name ?? invite.email,
    role: invite.role,
    schoolName: invite.school.name,
    inviteLink,
  });

  return { delivered: true, rawToken };
}

/**
 * Inline fast path: called directly by the route handler right after the
 * Add School transaction commits, so the Founder gets the invite link back
 * in the same HTTP response in the common (no-crash) case — with zero added
 * latency versus the old synchronous-send design. Uses the same atomic
 * claim as the worker (claimSpecificJob), so if a process crash means this
 * never runs (or it runs but crashes before returning), the durable job row
 * is left PENDING/RUNNING-with-expired-lease and the standalone worker
 * (scripts/worker.ts, polling src/app/api/internal/worker) will claim and
 * complete it exactly once instead — the Founder just won't see the link
 * synchronously in that case.
 */
export async function runInviteEmailDeliveryInline(
  jobId: string,
  req?: Request
): Promise<{ status: "COMPLETED" | "FAILED" | "SKIPPED"; rawToken?: string; error?: string }> {
  const job = await claimSpecificJob(jobId);
  if (!job) return { status: "SKIPPED" };

  const parsed = inviteEmailDeliveryPayloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    await failJob(job.id, job.claimToken!, "Invalid job payload");
    return { status: "FAILED", error: "Invalid job payload" };
  }

  try {
    const result = await deliverInviteEmailNow(parsed.data.inviteId, req);
    await completeJob(job.id, job.claimToken!, { inviteId: parsed.data.inviteId, delivered: result.delivered, reason: result.reason ?? null });
    return { status: "COMPLETED", rawToken: result.rawToken };
  } catch (err) {
    // Sanitized: never include the invite link/token, only the provider's
    // own error message (see sendStaffInviteEmail / getEmailProvider).
    const message = err instanceof Error ? err.message.slice(0, 300) : "Invite email delivery failed";
    await failJob(job.id, job.claimToken!, message);
    return { status: "FAILED", error: message };
  }
}

const handlers: Record<string, JobHandler> = {
  REPORT_CARD_BATCH_GENERATION: async (job, { updateProgress }) => {
    const payload = reportCardBatchPayloadSchema.parse(job.payload);
    let processed = 0;
    let failed = 0;
    const sampleFailures: { studentId: string; error: string }[] = [];

    // Shared batch context (scheme/template/attendance/exam-results/published
    // cards) is loaded ONCE for the entire batch — see report-cards.ts.
    const ctx = await buildReportCardBatchContext({
      schoolId: payload.schoolId,
      sectionId: payload.sectionId,
      examSchemeId: payload.examSchemeId,
      studentIds: payload.studentIds,
    });
    if (!ctx) throw new Error("Exam scheme not found in this school");

    for (const studentId of payload.studentIds) {
      try {
        // Reuses the single-student generation service (idempotent upsert of the
        // target report card) — one bad student never aborts the whole batch.
        const card = await generateReportCardForStudent(ctx, {
          teacherId: payload.teacherId,
          studentId,
          classTeacherRemark: payload.classTeacherRemark ?? undefined,
        });
        if (!card) {
          failed += 1;
          if (sampleFailures.length < 20) sampleFailures.push({ studentId, error: "No report card produced" });
        }
      } catch {
        failed += 1;
        if (sampleFailures.length < 20) sampleFailures.push({ studentId, error: "Generation failed" });
      }
      processed += 1;
      await updateProgress(processed, failed);
    }

    return {
      processedItems: processed,
      failedItems: failed,
      resultMetadata: { total: payload.studentIds.length, generated: processed - failed, failed, sampleFailures },
    };
  },

  STUDENT_BULK_IMPORT: async (job, { updateProgress }) => {
    const payload = studentBulkImportPayloadSchema.parse(job.payload);

    const file = await prisma.storedFile.findFirst({
      where: { id: payload.storedFileId, schoolId: payload.schoolId },
    });
    if (!file) throw new Error("Import source file not found");

    // The import source's retention window (PART 19) only becomes knowable
    // once this job reaches a terminal state — set it exactly once here,
    // whichever path is taken, rather than trusting a value assigned at
    // upload time.
    const markRetention = async (status: "COMPLETED" | "FAILED") => {
      const { retentionPolicy, expiresAt } = studentImportSourceRetention(status, systemClock.now());
      await prisma.storedFile.update({ where: { id: file.id }, data: { retentionPolicy, expiresAt } }).catch((err) => {
        console.error("[job-handlers] failed to set student-import retention expiry", { fileId: file.id, err });
      });
    };

    try {
      const bytes = await readManagedFileBytes(file);
      if (!bytes) throw new Error("Import source object is missing");

      let rows: unknown;
      try {
        rows = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new Error("Import source is not valid JSON");
      }
      if (!Array.isArray(rows)) throw new Error("Import source must be a JSON array of rows");

      // Re-evaluate the plan cap at processing time (not creation time).
      const { maxStudents, currentCount } = await getStudentLimitInfo(payload.schoolId);
      const summary = await importStudentRows(
        payload.schoolId,
        rows as ImportRow[],
        { maxStudents, currentCount },
        (processed, _created, failed) => updateProgress(processed, failed)
      );

      await markRetention("COMPLETED");
      return {
        processedItems: summary.total,
        failedItems: summary.failed,
        resultMetadata: {
          total: summary.total,
          created: summary.created,
          skipped: summary.skipped,
          failed: summary.failed,
          sampleErrors: summary.results.filter((r) => !r.success).slice(0, 20),
        },
      };
    } catch (err) {
      await markRetention("FAILED");
      throw err;
    }
  },

  SMART_TIMETABLE_GENERATION: async (job, { updateProgress }) => {
    const payload = smartTimetableGenerationPayloadSchema.parse(job.payload);
    let processed = 0;
    let failed = 0;

    const { results } = await generateSectionsBatch({
      schoolId: payload.schoolId,
      createdById: payload.createdById,
      generationSeed: payload.generationSeed,
      sections: payload.sections,
      onProgress: async (done, _total, latest) => {
        processed = done;
        if (latest.validationStatus !== "VALID") failed += 1;
        await updateProgress(processed, failed);
      },
    });

    return {
      processedItems: processed,
      failedItems: failed,
      resultMetadata: {
        sectionsTotal: payload.sections.length,
        sectionsSucceeded: results.filter((r) => r.validationStatus === "VALID").length,
        sectionsFailed: failed,
        results: results.map((r) => ({
          sectionId: r.sectionId,
          draftId: r.draftId,
          outcome: r.outcome,
          validationStatus: r.validationStatus,
          qualityScore: r.qualityScore,
          assignedCount: r.assignedCount,
          requiredCount: r.requiredCount,
        })),
      },
    };
  },

  FILE_RETENTION_CLEANUP: async (job, { updateProgress }) => {
    fileRetentionCleanupPayloadSchema.parse(job.payload);
    const now = systemClock.now();

    let provider;
    try {
      provider = getStorageProvider();
    } catch (err) {
      if (err instanceof StorageError && err.code === "NOT_CONFIGURED") {
        // Nothing to clean up if storage was never configured — a safe no-op, not a failure.
        return { processedItems: 0, failedItems: 0, resultMetadata: { batchSize: 0, deleted: 0, skipped: 0, failed: 0, storageNotConfigured: true } };
      }
      throw err;
    }

    // Bounded batch (PART 20) — never loads every expired file into memory.
    const batch = await prisma.storedFile.findMany({
      where: { retentionPolicy: "EXPIRING", deletedAt: null, expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
      take: FILE_RETENTION_CLEANUP_BATCH_SIZE,
    });

    let deleted = 0;
    let failed = 0;
    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      try {
        // Idempotent by provider contract: S3's DeleteObject and the in-memory
        // provider's Map.delete are both no-ops (not errors) when the key is
        // already gone — "already missing" is therefore automatically treated
        // as a cleanable success here, never a failure.
        await provider.deleteObject(file.storageKey);
        await prisma.storedFile.update({ where: { id: file.id }, data: { deletedAt: now } });
        deleted++;
      } catch (err) {
        // A transient storage error must NOT mark the row deleted — leave it
        // for the next cleanup run to retry.
        console.error("[job-handlers] file-retention cleanup: delete failed, will retry next run", {
          fileId: file.id,
          err: err instanceof Error ? err.message : err,
        });
        failed++;
      }
      await updateProgress(i + 1, failed);
    }

    return {
      processedItems: batch.length,
      failedItems: failed,
      resultMetadata: {
        batchSize: batch.length,
        deleted,
        skipped: 0,
        failed,
        hasMore: batch.length === FILE_RETENTION_CLEANUP_BATCH_SIZE,
      },
    };
  },
  SCHOOL_DATA_PURGE: async (job) => {
    const payload = schoolDataPurgePayloadSchema.parse(job.payload);
    const { schoolId } = payload;

    // Compare-and-swap claim: only a school still eligible for purge
    // (PENDING_DELETION past its retention window, a previously
    // DELETION_FAILED school being retried, or DELETING already — a
    // crash/lease-expiry re-entry into an already-in-progress purge, which
    // must be allowed to resume) transitions to/stays DELETING. If a Founder
    // cancelled/restored it before this ran (only possible while still
    // PENDING_DELETION — cancelSchoolDeletion refuses once DELETING), the
    // count is 0 — treat that as a clean, successful no-op rather than an
    // error (the race is EXPECTED and safe, not exceptional).
    const claimed = await prisma.school.updateMany({
      where: { id: schoolId, status: { in: ["PENDING_DELETION", "DELETION_FAILED", "DELETING"] } },
      data: { status: "DELETING" },
    });
    if (claimed.count === 0) {
      return { processedItems: 0, failedItems: 0, resultMetadata: { schoolId, skipped: true, reason: "not eligible (cancelled/restored or already purged)" } };
    }

    await prisma.schoolDeletionAudit.create({
      data: { schoolId, actorId: job.createdById ?? "system", action: "PURGE_STARTED", status: "DELETING" },
    });

    let counts: Record<string, number> = {};
    try {
      counts = await purgeSchoolData(schoolId, {
        onBatch: async (label, deletedInStep) => {
          console.log(`[job-handlers] SCHOOL_DATA_PURGE ${schoolId}: ${label} -${deletedInStep}`);
        },
      });

      // School row deleted LAST — every explicitly-tracked high-volume child
      // is already gone; Postgres cascade sweeps the remaining low-volume
      // administrative tables (see purgeSchoolData's header comment for the
      // full verified list) in this one final statement.
      await prisma.school.delete({ where: { id: schoolId } });

      await prisma.schoolDeletionAudit.create({
        data: { schoolId, actorId: job.createdById ?? "system", action: "PURGE_COMPLETED", status: "DELETED", counts },
      });
    } catch (err) {
      const sanitizedMessage = (err instanceof Error ? err.message : "Purge failed").slice(0, 500);
      await prisma.school.updateMany({
        where: { id: schoolId },
        data: {
          status: "DELETION_FAILED",
          deletionRetryCount: { increment: 1 },
          deletionLastError: sanitizedMessage,
        },
      });
      await prisma.schoolDeletionAudit.create({
        data: { schoolId, actorId: job.createdById ?? "system", action: "PURGE_FAILED", status: "DELETION_FAILED", counts },
      });
      throw err;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { processedItems: total, failedItems: 0, resultMetadata: { schoolId, counts } };
  },

  // Poller path (src/lib/job-processor.ts / scripts/worker.ts via the
  // internal worker route) — the job is already claimed (RUNNING) by the
  // time this runs, so it just performs the delivery step. No req/origin is
  // available here; deliverInviteEmailNow falls back to NEXTAUTH_URL/AUTH_URL.
  INVITE_EMAIL_DELIVERY: async (job) => {
    const payload = inviteEmailDeliveryPayloadSchema.parse(job.payload);
    const result = await deliverInviteEmailNow(payload.inviteId);
    return {
      processedItems: result.delivered ? 1 : 0,
      failedItems: 0,
      resultMetadata: { inviteId: payload.inviteId, delivered: result.delivered, reason: result.reason ?? null },
    };
  },
};

export function getJobHandler(type: string): JobHandler | null {
  return handlers[type] ?? null;
}
