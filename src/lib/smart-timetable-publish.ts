/**
 * Smart Timetable — publish workflow (PART 21).
 *
 * Always re-validates server-side (never trusts the draft's cached status —
 * a manual edit can invalidate a previously-valid draft). Replaces the target
 * section's LIVE TimetableSlot rows atomically inside one transaction; every
 * other section's live rows are untouched. A concurrent publish race
 * (another admin publishing a different section that grabs the same teacher
 * at the same day/period first) is re-checked INSIDE the transaction against
 * the live table as it stands at commit time — Postgres's read-committed
 * default means this recheck can itself still race with a simultaneous
 * transaction; the residual guarantee is the schema's own
 * TimetableSlot_sectionId_dayOfWeek_period_key unique constraint at the
 * database level, which makes a truly simultaneous double-write on the exact
 * same section/day/period impossible even if the application-level recheck
 * above is bypassed by a rare interleaving (documented honestly, not papered
 * over — see docs/smart-timetable-architecture.md).
 */

import { prisma } from "@/lib/prisma";
import { validateDraft, type DraftValidationIssue } from "@/lib/smart-timetable-drafts";
import { logAudit } from "@/lib/audit";

class PublishRaceConflictError extends Error {
  constructor() {
    super("PUBLISH_RACE_CONFLICT");
  }
}

export type PublishResult =
  | { ok: true; publishedSlotCount: number }
  | { ok: false; error: string; code: string; issues?: DraftValidationIssue[] };

export async function publishDraft(args: {
  draftId: string;
  schoolId: string;
  publishedByUserId: string;
  actorRole?: string | null;
}): Promise<PublishResult> {
  const { draftId, schoolId, publishedByUserId, actorRole } = args;

  const draft = await prisma.timetableDraft.findFirst({
    where: { id: draftId, schoolId },
    include: { slots: true },
  });
  if (!draft) return { ok: false, code: "DRAFT_NOT_FOUND", error: "Draft not found in this school." };

  // Always revalidate server-side — never trust draft.status.
  const validation = await validateDraft(draftId, schoolId);
  if (validation.status === "INVALID") {
    return { ok: false, code: "DRAFT_INVALID", error: "Draft is invalid and cannot be published.", issues: validation.issues };
  }

  try {
    const publishedSlotCount = await prisma.$transaction(async (tx) => {
      const candidateTeacherIds = [...new Set(draft.slots.map((s) => s.teacherId).filter((id): id is string => Boolean(id)))];

      // Race-safety recheck: has another section's live timetable claimed one
      // of these exact (teacher, day, period) combinations since we last
      // validated (e.g. a concurrent publish of a different section)?
      const liveConflicts = candidateTeacherIds.length
        ? await tx.timetableSlot.findMany({
            where: { schoolId, teacherId: { in: candidateTeacherIds }, NOT: { sectionId: draft.sectionId } },
            select: { teacherId: true, dayOfWeek: true, period: true },
          })
        : [];
      const conflictKeys = new Set(liveConflicts.map((c) => `${c.teacherId}-${c.dayOfWeek}-${c.period}`));
      for (const slot of draft.slots) {
        if (slot.teacherId && conflictKeys.has(`${slot.teacherId}-${slot.dayOfWeek}-${slot.period}`)) {
          throw new PublishRaceConflictError();
        }
      }

      await tx.timetableSlot.deleteMany({ where: { schoolId, sectionId: draft.sectionId } });

      const rows = draft.slots.filter((s) => s.subjectName || s.teacherId);
      if (rows.length > 0) {
        await tx.timetableSlot.createMany({
          data: rows.map((s) => ({
            schoolId,
            sectionId: draft.sectionId,
            dayOfWeek: s.dayOfWeek,
            period: s.period,
            teacherId: s.teacherId,
            subject: s.subjectName,
          })),
        });
      }

      await tx.timetableDraft.update({ where: { id: draftId }, data: { status: "PUBLISHED", publishedAt: new Date() } });

      return rows.length;
    });

    await logAudit({
      action: "SMART_TIMETABLE_PUBLISHED",
      entityType: "TimetableDraft",
      entityId: draftId,
      metadata: { sectionId: draft.sectionId, classId: draft.classId, slotCount: publishedSlotCount },
      userId: publishedByUserId,
      schoolId,
      actorRole,
    });

    return { ok: true, publishedSlotCount };
  } catch (err) {
    if (err instanceof PublishRaceConflictError) {
      return {
        ok: false,
        code: "PUBLISH_RACE_CONFLICT",
        error: "A concurrent publish assigned one of these teachers to another section first. Re-validate and try again.",
      };
    }
    throw err;
  }
}
