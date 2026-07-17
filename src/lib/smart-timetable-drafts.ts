/**
 * Smart Timetable — draft CRUD, locked-slot support, and the authoritative
 * draft validation service (PART 10, PART 11, PART 20).
 */

import { prisma } from "@/lib/prisma";
import type { TimetableDraftSource, Prisma } from "@/generated/prisma/client";
import { loadGenerationContext, reserveSlot, isTeacherEligibleForSubject, normalizeSubjectName } from "@/lib/smart-timetable-context";
import { resolveEffectiveWorkloadRule } from "@/lib/teacher-workload-rules";
import { checkHardConstraints, type ConstraintViolation, type AssignmentCandidate } from "@/lib/smart-timetable-constraints";

export async function createDraft(args: {
  schoolId: string;
  classId: string;
  sectionId: string;
  createdById: string;
  source?: TimetableDraftSource;
}) {
  return prisma.timetableDraft.create({
    data: {
      schoolId: args.schoolId,
      classId: args.classId,
      sectionId: args.sectionId,
      createdById: args.createdById,
      source: args.source ?? "MANUAL",
      status: "DRAFT",
    },
  });
}

export function getDraft(draftId: string, schoolId: string) {
  return prisma.timetableDraft.findFirst({
    where: { id: draftId, schoolId },
    include: { slots: { orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }] } },
  });
}

export function listDrafts(schoolId: string, filters: { sectionId?: string; classId?: string; skip: number; take: number }) {
  const where = { schoolId, ...(filters.sectionId ? { sectionId: filters.sectionId } : {}), ...(filters.classId ? { classId: filters.classId } : {}) };
  return prisma.$transaction([
    prisma.timetableDraft.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: filters.skip, take: filters.take }),
    prisma.timetableDraft.count({ where }),
  ]);
}

export async function draftBelongsToSchool(draftId: string, schoolId: string): Promise<boolean> {
  const draft = await prisma.timetableDraft.findFirst({ where: { id: draftId, schoolId }, select: { id: true } });
  return Boolean(draft);
}

// ── Subject requirements ──────────────────────────────────────────────────────
export interface SubjectRequirementInput {
  /** Canonical Master Subject id — the API layer has already validated this belongs to the school/class/section before calling here. */
  subjectId: string;
  subjectName: string;
  requiredPeriodsPerWeek: number;
  minPeriodsPerDay?: number | null;
  maxPeriodsPerDay?: number | null;
  allowConsecutive?: boolean;
  preferredTeacherId?: string | null;
}

/**
 * Replaces the full canonical (subjectId-linked) requirement set for a
 * section: idempotent upsert per subjectId, deletes any canonical row not
 * present in the new list. Legacy rows (subjectId IS NULL, predating Master
 * Subject enforcement) are never touched here — they can only ever be
 * matched/deleted by subjectId, so a NULL subjectId row never satisfies the
 * `notIn` filter below and is left untouched, preserved for viewing.
 */
export async function setSubjectRequirements(args: {
  schoolId: string;
  classId: string;
  sectionId: string;
  requirements: SubjectRequirementInput[];
}) {
  const { schoolId, classId, sectionId, requirements } = args;
  const subjectIds = requirements.map((r) => r.subjectId);

  await prisma.$transaction([
    prisma.timetableSubjectRequirement.deleteMany({
      where: { sectionId, subjectId: { notIn: subjectIds.length ? subjectIds : ["__none__"] } },
    }),
    ...requirements.map((r) =>
      prisma.timetableSubjectRequirement.upsert({
        where: { sectionId_subjectId: { sectionId, subjectId: r.subjectId } },
        create: {
          schoolId,
          classId,
          sectionId,
          subjectId: r.subjectId,
          subjectName: r.subjectName,
          requiredPeriodsPerWeek: r.requiredPeriodsPerWeek,
          minPeriodsPerDay: r.minPeriodsPerDay ?? null,
          maxPeriodsPerDay: r.maxPeriodsPerDay ?? null,
          allowConsecutive: r.allowConsecutive ?? false,
          preferredTeacherId: r.preferredTeacherId ?? null,
        },
        update: {
          subjectName: r.subjectName,
          requiredPeriodsPerWeek: r.requiredPeriodsPerWeek,
          minPeriodsPerDay: r.minPeriodsPerDay ?? null,
          maxPeriodsPerDay: r.maxPeriodsPerDay ?? null,
          allowConsecutive: r.allowConsecutive ?? false,
          preferredTeacherId: r.preferredTeacherId ?? null,
        },
      })
    ),
  ]);

  return prisma.timetableSubjectRequirement.findMany({ where: { sectionId }, orderBy: { subjectName: "asc" } });
}

export function getSubjectRequirements(sectionId: string) {
  return prisma.timetableSubjectRequirement.findMany({ where: { sectionId }, orderBy: { subjectName: "asc" } });
}

// ── Slot mutation (manual builder) ────────────────────────────────────────────
export type SlotMutationResult =
  | { ok: true; slot: { id: string; dayOfWeek: number; period: number; subjectName: string | null; teacherId: string | null; locked: boolean } }
  | { ok: false; error: string; code: string; violations?: ConstraintViolation[] };

/**
 * Adds or overwrites one draft slot. Validates hard constraints against the
 * live timetable + this draft's own current slots before writing (PART 6).
 * Refuses to silently move/overwrite a LOCKED existing slot (PART 11).
 */
export async function upsertDraftSlot(args: {
  draftId: string;
  schoolId: string;
  sectionId: string;
  dayOfWeek: number;
  period: number;
  subjectName: string | null;
  teacherId: string | null;
  locked?: boolean;
  source?: string;
  reasonCode?: string;
}): Promise<SlotMutationResult> {
  const { draftId, schoolId, sectionId, dayOfWeek, period, subjectName, teacherId, locked, source, reasonCode } = args;

  const existing = await prisma.timetableDraftSlot.findUnique({
    where: { draftId_dayOfWeek_period: { draftId, dayOfWeek, period } },
  });
  if (existing?.locked) {
    return {
      ok: false,
      code: "LOCKED_SLOT_CONFLICT",
      error: "This slot is locked and cannot be overwritten. Unlock it first.",
    };
  }

  // A slot's subject may only ever be one this section actually has a
  // canonical (subjectId-linked) requirement for — closes the manual-builder
  // path that would otherwise let an arbitrary or legacy/unmapped subject
  // name reach a draft slot (and, on publish, a live TimetableSlot) without
  // ever going through Master Subject validation.
  if (subjectName) {
    const canonicalRequirements = await prisma.timetableSubjectRequirement.findMany({
      where: { sectionId, subjectId: { not: null } },
      select: { subjectName: true },
    });
    const wanted = normalizeSubjectName(subjectName);
    const isApplicable = canonicalRequirements.some((r) => normalizeSubjectName(r.subjectName) === wanted);
    if (!isApplicable) {
      return {
        ok: false,
        code: "SUBJECT_NOT_APPLICABLE",
        error: `"${subjectName}" is not a Master-Subject-linked requirement configured for this section.`,
      };
    }
  }

  if (teacherId && subjectName) {
    const ctx = await loadGenerationContext({ schoolId, targetSectionIds: [sectionId], batchDraftIds: [draftId] });
    const teacher = ctx.teachers.get(teacherId);
    if (!teacher) return { ok: false, code: "TEACHER_NOT_FOUND", error: "Teacher does not belong to this school." };
    const rule = resolveEffectiveWorkloadRule(ctx.schoolDefaults, teacher.workloadOverride);
    const candidate: AssignmentCandidate = { teacherId, sectionId, day: dayOfWeek, period, subjectName };
    const violations = checkHardConstraints(ctx, candidate, rule).filter(
      // Exclude "occupied by this exact same slot" false-positives when
      // re-saving the same teacher into a slot they already hold here.
      (v) => !(v.code === "TEACHER_SLOT_OCCUPIED" && existing?.teacherId === teacherId)
    );
    if (violations.some((v) => v.severity === "ERROR")) {
      return { ok: false, code: "HARD_CONSTRAINT_VIOLATION", error: "This assignment violates a hard constraint.", violations };
    }
  }

  const slot = await prisma.timetableDraftSlot.upsert({
    where: { draftId_dayOfWeek_period: { draftId, dayOfWeek, period } },
    create: { draftId, dayOfWeek, period, subjectName, teacherId, locked: locked ?? false, source: source ?? "manual", reasonCode },
    update: { subjectName, teacherId, locked: locked ?? existing?.locked ?? false, source: source ?? "manual", reasonCode },
  });

  await prisma.timetableDraft.update({ where: { id: draftId }, data: { status: "DRAFT" } });

  return {
    ok: true,
    slot: { id: slot.id, dayOfWeek: slot.dayOfWeek, period: slot.period, subjectName: slot.subjectName, teacherId: slot.teacherId, locked: slot.locked },
  };
}

export async function removeDraftSlot(draftId: string, dayOfWeek: number, period: number): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.timetableDraftSlot.findUnique({ where: { draftId_dayOfWeek_period: { draftId, dayOfWeek, period } } });
  if (!existing) return { ok: true };
  if (existing.locked) return { ok: false, error: "This slot is locked. Unlock it before removing." };
  await prisma.timetableDraftSlot.delete({ where: { id: existing.id } });
  return { ok: true };
}

export async function setSlotLocked(draftId: string, dayOfWeek: number, period: number, locked: boolean): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.timetableDraftSlot.findUnique({ where: { draftId_dayOfWeek_period: { draftId, dayOfWeek, period } } });
  if (!existing) return { ok: false, error: "No slot exists at this day/period to lock." };
  await prisma.timetableDraftSlot.update({ where: { id: existing.id }, data: { locked } });
  return { ok: true };
}

// ── Authoritative validation (PART 20) ────────────────────────────────────────
export interface DraftValidationIssue {
  code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface DraftValidationResult {
  status: "VALID" | "INVALID";
  issues: DraftValidationIssue[];
}

/**
 * Re-derives validity from scratch every time — never trusts the generator or
 * a cached draft.status, since manual edits can invalidate a previously-valid
 * draft. Replays every slot (including locked ones — a locked slot that is
 * already invalid must not be silently treated as valid) against the live
 * timetable + the draft's own accumulating occupancy, then checks aggregate
 * subject-period totals (H3).
 */
export async function validateDraft(draftId: string, schoolId: string): Promise<DraftValidationResult> {
  const draft = await prisma.timetableDraft.findFirst({
    where: { id: draftId, schoolId },
    include: { slots: { orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }] } },
  });
  if (!draft) return { status: "INVALID", issues: [{ code: "DRAFT_NOT_FOUND", severity: "ERROR", message: "Draft not found in this school." }] };

  const requirements = await prisma.timetableSubjectRequirement.findMany({ where: { sectionId: draft.sectionId } });

  // Occupancy EXCLUDING this draft's own slots (they're replayed manually below).
  const ctx = await loadGenerationContext({ schoolId, targetSectionIds: [draft.sectionId], batchDraftIds: [] });

  const issues: DraftValidationIssue[] = [];
  const subjectPeriodCounts = new Map<string, number>();

  for (const slot of draft.slots) {
    if (slot.teacherId && slot.subjectName) {
      const teacher = ctx.teachers.get(slot.teacherId);
      const rule = teacher ? resolveEffectiveWorkloadRule(ctx.schoolDefaults, teacher.workloadOverride) : null;
      const candidate: AssignmentCandidate = {
        teacherId: slot.teacherId,
        sectionId: draft.sectionId,
        day: slot.dayOfWeek,
        period: slot.period,
        subjectName: slot.subjectName,
      };
      const violations = checkHardConstraints(ctx, candidate, rule);
      for (const v of violations) {
        issues.push({
          ...v,
          metadata: { ...v.metadata, day: slot.dayOfWeek, period: slot.period, slotId: slot.id, locked: slot.locked },
        });
      }
    }
    if (slot.subjectName) {
      const key = normalizeSubjectName(slot.subjectName);
      subjectPeriodCounts.set(key, (subjectPeriodCounts.get(key) ?? 0) + 1);
    }
    // Reserve AFTER checking so this slot doesn't block itself, but DOES block
    // any later slot in the same draft (H1/H2 within the draft itself).
    reserveSlot(ctx, slot.teacherId, draft.sectionId, slot.dayOfWeek, slot.period);
  }

  // H3 — required period count per subject.
  for (const req of requirements) {
    const assigned = subjectPeriodCounts.get(normalizeSubjectName(req.subjectName)) ?? 0;
    if (assigned < req.requiredPeriodsPerWeek) {
      issues.push({
        code: "MISSING_REQUIRED_SUBJECT_PERIODS",
        severity: "ERROR",
        message: `${req.subjectName}: required ${req.requiredPeriodsPerWeek}, assigned ${assigned}.`,
        metadata: { subjectName: req.subjectName, required: req.requiredPeriodsPerWeek, assigned },
      });
    } else if (assigned > req.requiredPeriodsPerWeek) {
      issues.push({
        code: "EXCESS_SUBJECT_PERIODS",
        severity: "ERROR",
        message: `${req.subjectName}: required ${req.requiredPeriodsPerWeek}, but ${assigned} are assigned.`,
        metadata: { subjectName: req.subjectName, required: req.requiredPeriodsPerWeek, assigned },
      });
    }
  }

  // Teacher eligibility re-check (a teacher's eligibility rows could have
  // changed since the slot was placed) — H4, defense in depth.
  for (const slot of draft.slots) {
    if (!slot.teacherId || !slot.subjectName) continue;
    const teacher = ctx.teachers.get(slot.teacherId);
    if (teacher && !isTeacherEligibleForSubject(teacher, slot.subjectName)) {
      issues.push({
        code: "TEACHER_NOT_ELIGIBLE",
        severity: "ERROR",
        message: `${teacher.name} is not eligible to teach ${slot.subjectName} (day ${slot.dayOfWeek}, period ${slot.period}).`,
        metadata: { teacherId: slot.teacherId, day: slot.dayOfWeek, period: slot.period },
      });
    }
  }

  const status: "VALID" | "INVALID" = issues.some((i) => i.severity === "ERROR") ? "INVALID" : "VALID";

  await prisma.timetableDraft.update({
    where: { id: draftId },
    data: { status, diagnostics: { issues } as unknown as Prisma.InputJsonValue },
  });

  return { status, issues };
}
