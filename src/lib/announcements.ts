import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { parsePagination, paginated, type PaginationParams } from "@/lib/pagination";

/**
 * Targeted announcements — shared service layer.
 *
 * Every mutating/eligibility function here re-derives authorization from the
 * DB (schoolId/teacherId/sectionIds are never trusted from a caller without
 * being re-checked here) so API routes stay thin and every surface
 * (dashboard, teacher, student, parent) shares one source of truth for who
 * can see/create/edit what.
 *
 * Designed so a future delivery channel (e.g. WhatsApp) can consume a
 * PUBLISHED announcement without touching this file's internals: a single
 * `publishAnnouncement`/`transitionScheduledToPublished` call is the only
 * place status flips to PUBLISHED, and `getAnnouncementForDelivery` returns
 * the stable shape (title, body, scope, audience groups, resolved
 * recipients) a delivery worker would need — see that function's docstring.
 */

export const LEADERSHIP_ROLES = ["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"] as const;
export type LeadershipRole = (typeof LEADERSHIP_ROLES)[number];

export function isLeadershipRole(role: string | undefined | null): role is LeadershipRole {
  return Boolean(role) && (LEADERSHIP_ROLES as readonly string[]).includes(role as string);
}

const AUDIENCE_GROUPS = ["TEACHERS", "GUARDIANS", "STUDENTS"] as const;
export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

const TITLE_MAX = 200;
const BODY_MAX = 5000;

const targetSchema = z.object({
  classId: z.string().min(1),
  sectionId: z.string().min(1),
});

/**
 * Base input validation shared by create/update. `scheduledAt`/`expiresAt`
 * are accepted as ISO-8601 datetime strings (absolute instants) — comparing
 * absolute instants against `Date.now()` is correct regardless of the
 * school's configured timezone, so no separate timezone conversion is needed
 * for the future/ordering checks; the school's `timezone` field is used only
 * where a *local calendar day* is displayed/derived (see src/lib/school-time.ts),
 * not for these instant comparisons.
 */
export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`),
    body: z.string().trim().min(1, "Message is required").max(BODY_MAX, `Message must be ${BODY_MAX} characters or fewer`),
    scope: z.enum(["SCHOOL_WIDE", "CLASS_SECTION"]),
    audience: z.array(z.enum(AUDIENCE_GROUPS)).min(1, "Select at least one audience group"),
    targets: z.array(targetSchema).default([]),
    scheduledAt: z.string().datetime().nullish(),
    expiresAt: z.string().datetime().nullish(),
    publishNow: z.boolean().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.scope === "CLASS_SECTION" && data.targets.length === 0) {
      ctx.addIssue({ code: "custom", message: "At least one class/section is required for a targeted announcement", path: ["targets"] });
    }
    if (data.scope === "SCHOOL_WIDE" && data.targets.length > 0) {
      ctx.addIssue({ code: "custom", message: "A school-wide announcement cannot have class/section targets", path: ["targets"] });
    }
    if (data.scheduledAt) {
      const scheduled = new Date(data.scheduledAt);
      if (scheduled.getTime() <= Date.now()) {
        ctx.addIssue({ code: "custom", message: "Scheduled time must be in the future", path: ["scheduledAt"] });
      }
    }
    if (data.expiresAt) {
      const expires = new Date(data.expiresAt);
      const publishReference = data.scheduledAt ? new Date(data.scheduledAt) : new Date();
      if (expires.getTime() <= publishReference.getTime()) {
        ctx.addIssue({ code: "custom", message: "Expiry must be after the publish/schedule time", path: ["expiresAt"] });
      }
    }
    if (data.scheduledAt && data.publishNow) {
      ctx.addIssue({ code: "custom", message: "Cannot both schedule and publish immediately", path: ["publishNow"] });
    }
  });

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export class AnnouncementAuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** Teacher's currently-authorized (classId, sectionId) pairs — from active timetable slots and any mentor section, mirroring the pattern already used for homework (src/lib/homework.ts getTeacherAssignments). */
export async function getTeacherAuthorizedSections(teacherId: string, schoolId: string) {
  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, schoolId, isDeleted: false },
    select: {
      timetableSlots: {
        where: { schoolId },
        select: { section: { select: { id: true, classId: true } } },
      },
      mentorSection: { select: { id: true, classId: true } },
    },
  });
  if (!teacher) return [];

  const bySection = new Map<string, { classId: string; sectionId: string }>();
  for (const slot of teacher.timetableSlots) {
    if (slot.section) bySection.set(slot.section.id, { classId: slot.section.classId, sectionId: slot.section.id });
  }
  if (teacher.mentorSection) {
    bySection.set(teacher.mentorSection.id, { classId: teacher.mentorSection.classId, sectionId: teacher.mentorSection.id });
  }
  return [...bySection.values()];
}

/** Validates every requested target belongs to the school and, for a teacher creator, is within their authorized sections. Never trusts client-supplied classId — recomputes it from the section row. */
export async function validateTargets(
  schoolId: string,
  targets: { classId: string; sectionId: string }[],
  authorizedSectionIds?: Set<string>
): Promise<{ ok: true; targets: { classId: string; sectionId: string }[] } | { ok: false; error: string }> {
  if (targets.length === 0) return { ok: true, targets: [] };

  const sectionIds = [...new Set(targets.map((t) => t.sectionId))];
  const sections = await prisma.section.findMany({
    where: { id: { in: sectionIds }, class: { schoolId } },
    select: { id: true, classId: true },
  });
  const bySectionId = new Map(sections.map((s) => [s.id, s.classId]));

  const resolved: { classId: string; sectionId: string }[] = [];
  for (const sectionId of sectionIds) {
    const classId = bySectionId.get(sectionId);
    if (!classId) return { ok: false, error: "One or more selected sections do not belong to this school" };
    if (authorizedSectionIds && !authorizedSectionIds.has(sectionId)) {
      return { ok: false, error: "You are not authorized to target one or more of the selected sections" };
    }
    resolved.push({ classId, sectionId });
  }
  return { ok: true, targets: resolved };
}

type CreateContext =
  | { actorKind: "LEADERSHIP"; userId: string; role: LeadershipRole; schoolId: string }
  | { actorKind: "TEACHER"; userId: string; teacherId: string; schoolId: string };

/** Creates a DRAFT, SCHEDULED, or immediately-PUBLISHED announcement. Teachers are hard-restricted to CLASS_SECTION scope within their authorized sections; leadership may use either scope and any audience combination. */
export async function createAnnouncement(ctx: CreateContext, input: AnnouncementInput) {
  if (ctx.actorKind === "TEACHER") {
    if (input.scope !== "CLASS_SECTION") {
      throw new AnnouncementAuthError("Teachers can only create class/section-targeted announcements, never school-wide");
    }
    const authorizedSections = await getTeacherAuthorizedSections(ctx.teacherId, ctx.schoolId);
    const authorizedIds = new Set(authorizedSections.map((s) => s.sectionId));
    const validated = await validateTargets(ctx.schoolId, input.targets, authorizedIds);
    if (!validated.ok) throw new AnnouncementAuthError(validated.error, 403);

    const disallowedAudience = input.audience.filter((g) => g !== "STUDENTS" && g !== "GUARDIANS");
    if (disallowedAudience.length > 0) {
      throw new AnnouncementAuthError("Teachers can only target students and parents/guardians of their own classes", 403);
    }
  } else {
    const validated = await validateTargets(ctx.schoolId, input.targets);
    if (!validated.ok) throw new AnnouncementAuthError(validated.error, 400);
  }

  const status = input.scheduledAt ? "SCHEDULED" : input.publishNow ? "PUBLISHED" : "DRAFT";
  const now = new Date();
  const createdById = ctx.userId;
  const createdByRole = ctx.actorKind === "LEADERSHIP" ? ctx.role : "TEACHER";

  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        schoolId: ctx.schoolId,
        scope: input.scope,
        status,
        createdById,
        createdByRole,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        publishedAt: status === "PUBLISHED" ? now : null,
        publishedById: status === "PUBLISHED" ? createdById : null,
        audience: { createMany: { data: input.audience.map((group) => ({ group })) } },
        targets:
          input.targets.length > 0
            ? { createMany: { data: input.targets.map((t) => ({ schoolId: ctx.schoolId, classId: t.classId, sectionId: t.sectionId })) } }
            : undefined,
      },
      include: { audience: true, targets: true },
    });
    return created;
  });

  await logAudit({
    action: "ANNOUNCEMENT_CREATED",
    entityType: "Announcement",
    entityId: announcement.id,
    metadata: { title: announcement.title, scope: announcement.scope, status: announcement.status, audience: input.audience },
    userId: createdById,
    schoolId: ctx.schoolId,
    actorRole: createdByRole,
  });

  return announcement;
}

type ActorContext =
  | { actorKind: "LEADERSHIP"; userId: string; role: LeadershipRole; schoolId: string }
  | { actorKind: "TEACHER"; userId: string; teacherId: string; schoolId: string };

async function loadOwnedAnnouncement(schoolId: string, announcementId: string) {
  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId },
    include: { audience: true, targets: true },
  });
  if (!announcement) throw new AnnouncementAuthError("Announcement not found", 404);
  return announcement;
}

function assertMutableOwnership(ctx: ActorContext, announcement: { createdById: string }) {
  if (ctx.actorKind === "TEACHER" && announcement.createdById !== ctx.userId) {
    throw new AnnouncementAuthError("You can only manage announcements you created", 403);
  }
}

/** Edits a DRAFT or SCHEDULED announcement's content/targets/audience/schedule. Not for PUBLISHED rows — see correctAnnouncement. */
export async function updateDraftOrScheduled(ctx: ActorContext, announcementId: string, input: AnnouncementInput) {
  const existing = await loadOwnedAnnouncement(ctx.schoolId, announcementId);
  assertMutableOwnership(ctx, existing);
  if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
    throw new AnnouncementAuthError("Only draft or scheduled announcements can be edited this way — use the correction workflow for published announcements", 409);
  }

  if (ctx.actorKind === "TEACHER") {
    if (input.scope !== "CLASS_SECTION") throw new AnnouncementAuthError("Teachers can only create class/section-targeted announcements", 403);
    const authorizedSections = await getTeacherAuthorizedSections(ctx.teacherId, ctx.schoolId);
    const authorizedIds = new Set(authorizedSections.map((s) => s.sectionId));
    const validated = await validateTargets(ctx.schoolId, input.targets, authorizedIds);
    if (!validated.ok) throw new AnnouncementAuthError(validated.error, 403);
  } else {
    const validated = await validateTargets(ctx.schoolId, input.targets);
    if (!validated.ok) throw new AnnouncementAuthError(validated.error, 400);
  }

  const status = input.scheduledAt ? "SCHEDULED" : input.publishNow ? "PUBLISHED" : "DRAFT";
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.announcementTarget.deleteMany({ where: { announcementId } });
    await tx.announcementAudience.deleteMany({ where: { announcementId } });
    return tx.announcement.update({
      where: { id: announcementId },
      data: {
        title: input.title,
        body: input.body,
        scope: input.scope,
        status,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        publishedAt: status === "PUBLISHED" ? now : existing.publishedAt,
        publishedById: status === "PUBLISHED" ? ctx.userId : existing.publishedById,
        lastEditedById: ctx.userId,
        lastEditedAt: now,
        audience: { createMany: { data: input.audience.map((group) => ({ group })) } },
        targets:
          input.targets.length > 0
            ? { createMany: { data: input.targets.map((t) => ({ schoolId: ctx.schoolId, classId: t.classId, sectionId: t.sectionId })) } }
            : undefined,
      },
      include: { audience: true, targets: true },
    });
  });

  await logAudit({
    action: "ANNOUNCEMENT_UPDATED",
    entityType: "Announcement",
    entityId: announcementId,
    metadata: { title: updated.title, status: updated.status },
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    actorRole: ctx.actorKind === "LEADERSHIP" ? ctx.role : "TEACHER",
  });

  return updated;
}

/** Publishes a DRAFT or SCHEDULED announcement immediately. */
export async function publishAnnouncement(ctx: ActorContext, announcementId: string) {
  const existing = await loadOwnedAnnouncement(ctx.schoolId, announcementId);
  assertMutableOwnership(ctx, existing);
  if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
    throw new AnnouncementAuthError("Only draft or scheduled announcements can be published", 409);
  }
  const now = new Date();
  const updated = await prisma.announcement.update({
    where: { id: announcementId },
    data: { status: "PUBLISHED", publishedAt: now, publishedById: ctx.userId },
    include: { audience: true, targets: true },
  });
  await logAudit({
    action: "ANNOUNCEMENT_PUBLISHED",
    entityType: "Announcement",
    entityId: announcementId,
    metadata: { title: updated.title },
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    actorRole: ctx.actorKind === "LEADERSHIP" ? ctx.role : "TEACHER",
  });
  return updated;
}

/**
 * Flips SCHEDULED -> PUBLISHED for announcements whose scheduledAt has
 * passed. Visibility to recipients is ALREADY correctly derived from
 * persisted status+scheduledAt+expiresAt without this (see
 * resolveVisibleAnnouncementWhere), so this is not required for correctness
 * of what recipients see — it exists only so `status` and `publishedAt`
 * reflect reality for leadership/teacher dashboards and so a future delivery
 * worker has a single, stable "just published" transition to hook into. Safe
 * to call repeatedly (idempotent) and safe to invoke from any existing
 * cron/worker entrypoint the repo already has, or from a lazy check on read
 * — deliberately NOT wired to a new standalone cron job in this change (see
 * PR description for the rationale and the deferred follow-up).
 */
export async function transitionDueScheduledAnnouncements(schoolId?: string) {
  const now = new Date();
  const due = await prisma.announcement.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now }, ...(schoolId ? { schoolId } : {}) },
    select: { id: true, schoolId: true, createdById: true, createdByRole: true, title: true },
  });
  for (const row of due) {
    await prisma.announcement.update({
      where: { id: row.id },
      data: { status: "PUBLISHED", publishedAt: now, publishedById: row.createdById },
    });
    await logAudit({
      action: "ANNOUNCEMENT_PUBLISHED",
      entityType: "Announcement",
      entityId: row.id,
      metadata: { title: row.title, via: "SCHEDULED_TRANSITION" },
      userId: row.createdById,
      schoolId: row.schoolId,
      actorRole: row.createdByRole,
    });
  }
  return due.length;
}

const correctionSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  body: z.string().trim().min(1).max(BODY_MAX),
  expiresAt: z.string().datetime().nullish(),
});
export type CorrectionInput = z.infer<typeof correctionSchema>;
export { correctionSchema };

/** Edits a PUBLISHED announcement via the audited "correction" workflow — never silently overwrites; bumps correctionCount and writes an ANNOUNCEMENT_CORRECTED audit entry with before/after. */
export async function correctPublishedAnnouncement(ctx: ActorContext, announcementId: string, input: CorrectionInput) {
  const existing = await loadOwnedAnnouncement(ctx.schoolId, announcementId);
  assertMutableOwnership(ctx, existing);
  if (existing.status !== "PUBLISHED") {
    throw new AnnouncementAuthError("Only published announcements can be corrected", 409);
  }
  if (input.expiresAt) {
    const expires = new Date(input.expiresAt);
    if (existing.publishedAt && expires.getTime() <= existing.publishedAt.getTime()) {
      throw new AnnouncementAuthError("Expiry must be after the original publish time", 400);
    }
  }
  const now = new Date();
  const before = { title: existing.title, body: existing.body, expiresAt: existing.expiresAt };
  const updated = await prisma.announcement.update({
    where: { id: announcementId },
    data: {
      title: input.title,
      body: input.body,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt ? new Date(input.expiresAt) : null,
      lastEditedById: ctx.userId,
      lastEditedAt: now,
      correctionCount: { increment: 1 },
    },
    include: { audience: true, targets: true },
  });
  await logAudit({
    action: "ANNOUNCEMENT_CORRECTED",
    entityType: "Announcement",
    entityId: announcementId,
    metadata: { before, after: { title: updated.title, body: updated.body, expiresAt: updated.expiresAt }, correctionCount: updated.correctionCount },
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    actorRole: ctx.actorKind === "LEADERSHIP" ? ctx.role : "TEACHER",
  });
  return updated;
}

export async function cancelAnnouncement(ctx: ActorContext, announcementId: string) {
  const existing = await loadOwnedAnnouncement(ctx.schoolId, announcementId);
  assertMutableOwnership(ctx, existing);
  if (existing.status === "ARCHIVED" || existing.status === "CANCELLED") {
    throw new AnnouncementAuthError("Announcement is already archived or cancelled", 409);
  }
  const now = new Date();
  const updated = await prisma.announcement.update({
    where: { id: announcementId },
    data: { status: "CANCELLED", cancelledAt: now, cancelledById: ctx.userId },
  });
  await logAudit({
    action: "ANNOUNCEMENT_CANCELLED",
    entityType: "Announcement",
    entityId: announcementId,
    metadata: { title: updated.title },
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    actorRole: ctx.actorKind === "LEADERSHIP" ? ctx.role : "TEACHER",
  });
  return updated;
}

export async function archiveAnnouncement(ctx: ActorContext, announcementId: string) {
  const existing = await loadOwnedAnnouncement(ctx.schoolId, announcementId);
  assertMutableOwnership(ctx, existing);
  if (existing.status === "ARCHIVED") {
    throw new AnnouncementAuthError("Announcement is already archived", 409);
  }
  const now = new Date();
  const updated = await prisma.announcement.update({
    where: { id: announcementId },
    data: { status: "ARCHIVED", archivedAt: now, archivedById: ctx.userId },
  });
  await logAudit({
    action: "ANNOUNCEMENT_ARCHIVED",
    entityType: "Announcement",
    entityId: announcementId,
    metadata: { title: updated.title },
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    actorRole: ctx.actorKind === "LEADERSHIP" ? ctx.role : "TEACHER",
  });
  return updated;
}

// ── Recipient eligibility (server-side, never inferred client-side) ────────

/** Prisma where-clause fragment for "currently visible, published, non-cancelled" — reused by every recipient surface so scheduling/expiry can never be bypassed by a client. */
export function visibleNowWhere(now: Date = new Date()) {
  return {
    status: "PUBLISHED" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

export async function listAnnouncementsForStudent(schoolId: string, studentId: string, sectionId: string, pagination: PaginationParams) {
  const now = new Date();
  const where = {
    schoolId,
    status: "PUBLISHED" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    audience: { some: { group: "STUDENTS" as const } },
    AND: [{ OR: [{ scope: "SCHOOL_WIDE" as const }, { scope: "CLASS_SECTION" as const, targets: { some: { sectionId } } }] }],
  };
  const [data, total, reads] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include: { createdBy: { select: { name: true, role: true } } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.announcement.count({ where }),
    prisma.announcementRead.findMany({ where: { schoolId, actorType: "STUDENT", actorId: studentId }, select: { announcementId: true } }),
  ]);
  const readSet = new Set(reads.map((r) => r.announcementId));
  return paginated(
    data.map((a) => ({ ...a, isRead: readSet.has(a.id) })),
    total,
    pagination
  );
}

export async function listAnnouncementsForGuardian(schoolId: string, guardianId: string, pagination: PaginationParams) {
  const now = new Date();
  const links = await prisma.studentGuardian.findMany({
    where: { guardianId, schoolId },
    select: { student: { select: { id: true, name: true, sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } } } },
  });
  if (links.length === 0) return paginated([], 0, pagination);

  const sectionIds = [...new Set(links.map((l) => l.student.sectionId))];
  const where = {
    schoolId,
    status: "PUBLISHED" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    audience: { some: { group: "GUARDIANS" as const } },
    AND: [{ OR: [{ scope: "SCHOOL_WIDE" as const }, { scope: "CLASS_SECTION" as const, targets: { some: { sectionId: { in: sectionIds } } } }] }],
  };
  const [data, total, reads] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include: { createdBy: { select: { name: true, role: true } }, targets: { select: { sectionId: true } } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.announcement.count({ where }),
    prisma.announcementRead.findMany({ where: { schoolId, actorType: "GUARDIAN", actorId: guardianId }, select: { announcementId: true } }),
  ]);
  const readSet = new Set(reads.map((r) => r.announcementId));

  const dedupedWithRelevance = data.map((a) => {
    const relevantStudents =
      a.scope === "SCHOOL_WIDE"
        ? links.map((l) => l.student)
        : links
            .filter((l) => a.targets.some((t) => t.sectionId === l.student.sectionId))
            .map((l) => l.student);
    return {
      ...a,
      isRead: readSet.has(a.id),
      relevantStudents: relevantStudents.map((s) => ({ id: s.id, name: s.name })),
    };
  });

  return paginated(dedupedWithRelevance, total, pagination);
}

export async function listAnnouncementsForTeacher(schoolId: string, teacherId: string, teacherUserId: string, pagination: PaginationParams) {
  const now = new Date();
  const where = {
    schoolId,
    status: "PUBLISHED" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    AND: [
      {
        OR: [
          { audience: { some: { group: "TEACHERS" as const } }, scope: "SCHOOL_WIDE" as const },
          { createdById: teacherUserId },
        ],
      },
    ],
  };
  const [data, total, reads] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include: { createdBy: { select: { name: true, role: true } }, targets: true, audience: true },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.announcement.count({ where }),
    prisma.announcementRead.findMany({ where: { schoolId, actorType: "TEACHER", actorId: teacherId }, select: { announcementId: true } }),
  ]);
  const readSet = new Set(reads.map((r) => r.announcementId));
  return paginated(
    data.map((a) => ({ ...a, isRead: readSet.has(a.id) })),
    total,
    pagination
  );
}

// ── Read tracking ────────────────────────────────────────────────────────

type ReadActor = { actorType: "STUDENT"; actorId: string; sectionId: string } | { actorType: "GUARDIAN"; actorId: string; guardianId: string } | { actorType: "TEACHER"; actorId: string; teacherUserId: string };

/** Re-runs the same eligibility resolution used for listing before allowing a mark-read, so a non-recipient (or cross-school id) can never mark an announcement read. Idempotent via upsert on the (announcementId, actorType, actorId) unique constraint. */
export async function markAnnouncementRead(schoolId: string, announcementId: string, actor: ReadActor) {
  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId, ...visibleNowWhere() },
    include: { audience: true, targets: true },
  });
  if (!announcement) throw new AnnouncementAuthError("Announcement not found or not currently visible", 404);

  let eligible = false;
  if (actor.actorType === "STUDENT") {
    eligible =
      announcement.audience.some((a) => a.group === "STUDENTS") &&
      (announcement.scope === "SCHOOL_WIDE" || announcement.targets.some((t) => t.sectionId === actor.sectionId));
  } else if (actor.actorType === "GUARDIAN") {
    if (announcement.audience.some((a) => a.group === "GUARDIANS")) {
      if (announcement.scope === "SCHOOL_WIDE") {
        eligible = (await prisma.studentGuardian.count({ where: { guardianId: actor.guardianId, schoolId } })) > 0;
      } else {
        const sectionIds = announcement.targets.map((t) => t.sectionId);
        eligible = (await prisma.studentGuardian.count({ where: { guardianId: actor.guardianId, schoolId, student: { sectionId: { in: sectionIds } } } })) > 0;
      }
    }
  } else {
    eligible = (announcement.audience.some((a) => a.group === "TEACHERS") && announcement.scope === "SCHOOL_WIDE") || announcement.createdById === actor.teacherUserId;
  }

  if (!eligible) throw new AnnouncementAuthError("You are not an eligible recipient of this announcement", 403);

  await prisma.announcementRead.upsert({
    where: { announcementId_actorType_actorId: { announcementId, actorType: actor.actorType, actorId: actor.actorId } },
    create: { announcementId, schoolId, actorType: actor.actorType, actorId: actor.actorId },
    update: {},
  });
  return { ok: true };
}

// ── Aggregate delivery/read stats (bounded, no per-recipient PII) ─────────

/** Bounded aggregate counts only — total eligible recipients and total read, per audience group. Never returns a list of who read what. */
export async function getAnnouncementStats(schoolId: string, announcementId: string) {
  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId },
    include: { audience: true, targets: true },
  });
  if (!announcement) throw new AnnouncementAuthError("Announcement not found", 404);

  const sectionIds = announcement.targets.map((t) => t.sectionId);
  const groups = announcement.audience.map((a) => a.group);

  const results: Record<string, { eligible: number; read: number }> = {};

  if (groups.includes("STUDENTS")) {
    const eligible = await prisma.student.count({
      where: { schoolId, ...(announcement.scope === "CLASS_SECTION" ? { sectionId: { in: sectionIds } } : {}) },
    });
    const read = await prisma.announcementRead.count({ where: { announcementId, actorType: "STUDENT" } });
    results.STUDENTS = { eligible, read };
  }
  if (groups.includes("GUARDIANS")) {
    const eligible = await prisma.guardian.count({
      where: {
        schoolId,
        studentLinks: announcement.scope === "CLASS_SECTION" ? { some: { student: { sectionId: { in: sectionIds } } } } : { some: {} },
      },
    });
    const read = await prisma.announcementRead.count({ where: { announcementId, actorType: "GUARDIAN" } });
    results.GUARDIANS = { eligible, read };
  }
  if (groups.includes("TEACHERS")) {
    const eligible = await prisma.teacher.count({ where: { schoolId, isDeleted: false } });
    const read = await prisma.announcementRead.count({ where: { announcementId, actorType: "TEACHER" } });
    results.TEACHERS = { eligible, read };
  }

  return results;
}

/**
 * Stable internal contract a future delivery worker (e.g. WhatsApp) would
 * read from — returns the published announcement plus its resolved
 * recipient identifiers grouped by audience, WITHOUT sending anything. No
 * provider integration, credentials, or background job exists yet; this is
 * intentionally the only export a delivery feature would need to add on top
 * of, so that work can start from a clean boundary. Only ever returns rows
 * for PUBLISHED announcements.
 */
export async function getAnnouncementForDelivery(schoolId: string, announcementId: string) {
  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId, status: "PUBLISHED" },
    include: { audience: true, targets: true },
  });
  if (!announcement) return null;

  const groups = announcement.audience.map((a) => a.group);
  const sectionIds = announcement.targets.map((t) => t.sectionId);
  const scopedSection = announcement.scope === "CLASS_SECTION" ? { sectionId: { in: sectionIds } } : {};

  const [studentIds, guardianIds, teacherIds] = await Promise.all([
    groups.includes("STUDENTS") ? prisma.student.findMany({ where: { schoolId, ...scopedSection }, select: { id: true } }) : Promise.resolve([]),
    groups.includes("GUARDIANS")
      ? prisma.guardian.findMany({
          where: { schoolId, studentLinks: announcement.scope === "CLASS_SECTION" ? { some: { student: { sectionId: { in: sectionIds } } } } : { some: {} } },
          select: { id: true },
        })
      : Promise.resolve([]),
    groups.includes("TEACHERS") ? prisma.teacher.findMany({ where: { schoolId, isDeleted: false }, select: { id: true } }) : Promise.resolve([]),
  ]);

  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    scope: announcement.scope,
    publishedAt: announcement.publishedAt,
    recipients: {
      studentIds: studentIds.map((s) => s.id),
      guardianIds: guardianIds.map((g) => g.id),
      teacherIds: teacherIds.map((t) => t.id),
    },
  };
}

export { parsePagination };
