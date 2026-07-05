/**
 * Typed job handler registry. Each handler re-validates the persisted payload
 * (never trusts the DB Json), reuses the SAME business logic as the synchronous
 * path (no duplicated report-card / import logic), reports progress, and returns
 * a BOUNDED result summary (never thousands of rows or documents).
 */

import { prisma } from "@/lib/prisma";
import type { BackgroundJob } from "@/generated/prisma/client";
import { reportCardBatchPayloadSchema, studentBulkImportPayloadSchema, smartTimetableGenerationPayloadSchema } from "@/lib/jobs";
import { buildReportCardBatchContext, generateReportCardForStudent } from "@/lib/report-cards";
import { importStudentRows, type ImportRow } from "@/lib/student-import";
import { getStudentLimitInfo } from "@/lib/plan-limits";
import { readManagedFileBytes } from "@/lib/file-service";
import { generateSectionsBatch } from "@/lib/smart-timetable-batch";

export type JobHelpers = {
  updateProgress: (processed: number, failed: number) => Promise<void>;
};

export type JobResult = {
  processedItems: number;
  failedItems: number;
  resultMetadata: Record<string, unknown>;
};

export type JobHandler = (job: BackgroundJob, helpers: JobHelpers) => Promise<JobResult>;

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
};

export function getJobHandler(type: string): JobHandler | null {
  return handlers[type] ?? null;
}
