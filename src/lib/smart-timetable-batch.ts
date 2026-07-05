/**
 * Smart Timetable — multi-section batch generation (PART 17, PART 18).
 *
 * Sections are generated SEQUENTIALLY, each one's newly-persisted draft slots
 * becoming occupancy for every subsequent section in the same batch (shared
 * in-memory occupancy via smart-timetable-context.ts's batchDraftIds). An
 * unrelated, unlinked draft from another session is NEVER included — only
 * drafts explicitly passed into this same batch call. Nothing is published
 * here; a failed section simply reports its own diagnostics while every other
 * section's result is still returned (PART 18: "do not silently publish
 * successful sections" — publishing remains a separate, explicit operation).
 */

import { generateDraft, type CompletionMode, type GenerateDraftResult } from "@/lib/smart-timetable-generator";

export interface BatchSectionInput {
  classId: string;
  sectionId: string;
  completionMode?: CompletionMode;
  draftId?: string;
}

export interface BatchSectionResult extends GenerateDraftResult {
  sectionId: string;
}

export async function generateSectionsBatch(args: {
  schoolId: string;
  sections: BatchSectionInput[];
  createdById: string;
  generationSeed?: string;
  onProgress?: (processed: number, total: number, latest: BatchSectionResult) => Promise<void>;
}): Promise<{ results: BatchSectionResult[] }> {
  const { schoolId, sections, createdById, generationSeed, onProgress } = args;
  const results: BatchSectionResult[] = [];
  const batchDraftIds: string[] = [];

  for (const section of sections) {
    const result = await generateDraft({
      schoolId,
      classId: section.classId,
      sectionId: section.sectionId,
      draftId: section.draftId,
      completionMode: section.completionMode,
      batchDraftIds,
      generationSeed,
      createdById,
    });
    batchDraftIds.push(result.draftId);
    const sectionResult = { sectionId: section.sectionId, ...result };
    results.push(sectionResult);
    if (onProgress) await onProgress(results.length, sections.length, sectionResult);
  }

  return { results };
}
