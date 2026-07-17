/**
 * Unified Notification Center v1 — core service layer.
 *
 * Two creation paths, chosen by recipient-count shape (never by convenience):
 *  - `createNotificationsBounded`: SYNCHRONOUS, in the same transaction as the
 *    triggering write, for small explicitly-enumerated recipient sets (a leave
 *    decision's 1-3 recipients, a correction naming a handful of students).
 *  - `enqueueNotificationFanout`: DURABLE outbox job (BackgroundJob,
 *    NOTIFICATION_FANOUT), created in the SAME transaction as the triggering
 *    write, for potentially unbounded recipient sets (a whole section/school
 *    of students+guardians+teachers — attendance submission, homework
 *    publish, announcement publish/correction). A separate worker resolves
 *    it (see src/lib/job-handlers.ts) — never a synchronous unbounded loop
 *    inside a web request.
 *
 * Idempotency: every Notification row's `idempotencyKey` is a deterministic
 * function of (eventType, entityType, entityId, recipient, versionKey). A
 * retried business action or a re-delivered fan-out job attempt therefore
 * always computes the SAME key for the same logical event+recipient, and the
 * database's unique constraint on that column turns the retry into a no-op
 * (a P2002 is caught here and treated as "already delivered", not an error).
 * `versionKey` is what lets a GENUINELY new occurrence of a recurring event
 * (e.g. an announcement correction bumping `correctionCount`, or a homework
 * edit bumping `updatedAt`) still create a fresh notification.
 *
 * Metadata allow-list (never store more than this, never raw request bodies,
 * never free-form translated copy, never unnecessary student PII — display
 * copy is rendered client-side from eventType + this metadata through
 * locales/en.json / hi.json):
 *   - titles/names already safe to show the recipient (e.g. a homework
 *     subject, an announcement title, a subject/section name)
 *   - counts (e.g. studentCount)
 *   - stable ids already covered by entityType/entityId or needed for a deep
 *     link (e.g. sectionId, correctionRequestId)
 *   - enum values (e.g. the attendance status, the leave decision)
 * Never: teacherRemark/private homework fields, admissions internal notes,
 * storage keys, another school's data, full request bodies.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma, NotificationEventType, NotificationRecipientType } from "@/generated/prisma/client";
import { hasPrismaErrorCode } from "@/lib/tenant";
import { notificationFanoutPayloadSchema, type NotificationFanoutPayload } from "@/lib/jobs";
import { resolveEffectiveOperationalRole } from "@/lib/operational-role-resolver";

export type { NotificationEventType, NotificationRecipientType };

export interface RecipientRef {
  recipientType: NotificationRecipientType;
  recipientId: string;
}

/**
 * A single bounded-creation call must never be handed an unbounded list —
 * class/school-wide fan-out MUST go through enqueueNotificationFanout
 * instead. This is a defensive ceiling, not a expected-usage limit.
 */
const MAX_BOUNDED_RECIPIENTS = 200;

function recipientColumns(ref: RecipientRef): Record<string, string> {
  switch (ref.recipientType) {
    case "STUDENT":
      return { studentId: ref.recipientId };
    case "GUARDIAN":
      return { guardianId: ref.recipientId };
    case "TEACHER":
      return { teacherId: ref.recipientId };
    case "ADMIN_STAFF":
      return { userId: ref.recipientId };
  }
}

export function buildNotificationIdempotencyKey(args: {
  eventType: NotificationEventType;
  entityType: string;
  entityId: string;
  recipientType: NotificationRecipientType;
  recipientId: string;
  versionKey?: string;
}): string {
  return [args.eventType, args.entityType, args.entityId, args.recipientType, args.recipientId, args.versionKey ?? ""].join(":");
}

type NotificationWriteClient = Pick<typeof prisma, "notification"> | Prisma.TransactionClient;

export interface NotificationEventInput {
  schoolId: string;
  eventType: NotificationEventType;
  entityType: string;
  entityId: string;
  recipients: RecipientRef[];
  metadata?: Record<string, unknown>;
  /** Stable "what changed" signal — see the module docstring's Idempotency section. */
  versionKey?: string;
}

/**
 * Synchronous, transaction-scoped creation for a SMALL, explicitly-enumerated
 * recipient set. Never call this with a class/school-wide recipient list —
 * use {@link enqueueNotificationFanout} for that (see module docstring).
 */
export async function createNotificationsBounded(tx: NotificationWriteClient, args: NotificationEventInput): Promise<{ created: number }> {
  if (args.recipients.length > MAX_BOUNDED_RECIPIENTS) {
    throw new Error(`createNotificationsBounded: ${args.recipients.length} recipients exceeds the bounded-path ceiling — use enqueueNotificationFanout instead`);
  }
  let created = 0;
  for (const r of args.recipients) {
    const idempotencyKey = buildNotificationIdempotencyKey({
      eventType: args.eventType,
      entityType: args.entityType,
      entityId: args.entityId,
      recipientType: r.recipientType,
      recipientId: r.recipientId,
      versionKey: args.versionKey,
    });
    try {
      await tx.notification.create({
        data: {
          schoolId: args.schoolId,
          recipientType: r.recipientType,
          ...recipientColumns(r),
          eventType: args.eventType,
          entityType: args.entityType,
          entityId: args.entityId,
          metadata: (args.metadata ?? {}) as Prisma.InputJsonValue,
          idempotencyKey,
        },
      });
      created++;
    } catch (err) {
      // Already delivered (retried action / duplicate event) — a safe no-op,
      // never a failure of the caller's business transaction.
      if (!hasPrismaErrorCode(err, "P2002")) throw err;
    }
  }
  return { created };
}

/**
 * Enqueues a durable NOTIFICATION_FANOUT job in the SAME transaction as the
 * triggering business write (the caller must pass its own `tx`). A crash
 * after commit but before the worker runs can never lose the fan-out — the
 * job row is the durable record of intent. Deduplicated at the DB level via
 * the existing partial unique index on (schoolId, type, payloadFingerprint)
 * WHERE status IN ('PENDING','RUNNING') (see the
 * 20260709000000_job_dedup_active_unique_index migration) — a second,
 * equivalent enqueue attempt (e.g. a retried publish request) collapses onto
 * the same still-active job instead of creating a duplicate.
 */
export async function enqueueNotificationFanout(
  tx: Prisma.TransactionClient,
  args: NotificationEventInput
): Promise<{ jobId: string; deduplicated?: boolean } | { skipped: true }> {
  if (args.recipients.length === 0) return { skipped: true };

  const payload: NotificationFanoutPayload = {
    schoolId: args.schoolId,
    eventType: args.eventType,
    entityType: args.entityType,
    entityId: args.entityId,
    recipients: args.recipients,
    metadata: args.metadata ?? {},
    versionKey: args.versionKey ?? "",
  };
  const parsed = notificationFanoutPayloadSchema.parse(payload);
  const payloadFingerprint = `${args.eventType}:${args.entityType}:${args.entityId}:${args.versionKey ?? ""}`;

  try {
    const job = await tx.backgroundJob.create({
      data: {
        type: "NOTIFICATION_FANOUT",
        schoolId: args.schoolId,
        payload: parsed as Prisma.InputJsonValue,
        totalItems: args.recipients.length,
        payloadFingerprint,
        status: "PENDING",
      },
    });
    return { jobId: job.id };
  } catch (err) {
    if (hasPrismaErrorCode(err, "P2002")) {
      const existing = await tx.backgroundJob.findFirst({
        where: { schoolId: args.schoolId, type: "NOTIFICATION_FANOUT", payloadFingerprint, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { jobId: existing.id, deduplicated: true };
    }
    throw err;
  }
}

/** Guardians linked to any of the given students, deduplicated, as recipient refs. */
export async function guardianRecipientsForStudents(studentIds: string[]): Promise<RecipientRef[]> {
  if (studentIds.length === 0) return [];
  const links = await prisma.studentGuardian.findMany({
    where: { studentId: { in: studentIds } },
    select: { guardianId: true },
  });
  const uniqueGuardianIds = Array.from(new Set(links.map((l) => l.guardianId)));
  return uniqueGuardianIds.map((guardianId) => ({ recipientType: "GUARDIAN" as const, recipientId: guardianId }));
}

/**
 * The always-authorized reviewer set for LEAVE/ATTENDANCE_CORRECTION
 * pending-review and reconciliation notifications: every School Owner,
 * School Admin and Vice Principal User of the school, PLUS (if one is
 * currently effective) the Teacher who holds the TEACHER_OPERATIONS
 * delegation — that bundle includes TEACHER_LEAVE_APPROVE/REJECT and
 * ATTENDANCE_CORRECTION_APPROVE/REJECT (see operational-capabilities.ts),
 * so a delegated teacher is a genuine reviewer of these requests and must
 * see them in their own inbox (GET /api/teacher/notifications), not only
 * via the admin-facing surface.
 *
 * The delegate is re-resolved from CURRENT facts on every call (via
 * resolveEffectiveOperationalRole — the same live resolver the
 * authorization guard in operational-authorization.ts uses), never cached
 * or trusted from a prior computation, so the recipient always matches
 * whoever is actually authorized to act at the moment the notification is
 * created. This is additive only — Owner/Admin/VP are always included
 * regardless of delegation (see requireSchoolAccessOrOperationalCapability's
 * base-access check).
 */
export async function leadershipRecipientsForSchool(schoolId: string): Promise<RecipientRef[]> {
  const [users, operationalRole] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId, role: { in: ["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"] } },
      select: { id: true },
    }),
    resolveEffectiveOperationalRole({ schoolId, roleType: "TEACHER_OPERATIONS" }),
  ]);
  const recipients: RecipientRef[] = users.map((u) => ({ recipientType: "ADMIN_STAFF" as const, recipientId: u.id }));
  if (operationalRole.effectiveTeacher) {
    recipients.push({ recipientType: "TEACHER" as const, recipientId: operationalRole.effectiveTeacher.id });
  }
  return recipients;
}
