/**
 * Founder "Add School" onboarding: creates the school, its subscription
 * (plan assignment), the initial admin invitation, AND a durable
 * INVITE_EMAIL_DELIVERY outbox job as ONE atomic, idempotent operation.
 * Replaces the previous two-step flow (bare school via POST /api/schools,
 * then a separate InviteAdminClient call) that let a school exist
 * indefinitely with no plan and no invited admin.
 *
 * Idempotency: the caller supplies a client-generated `idempotencyKey`
 * (School.creationIdempotencyKey, unique). A retried/duplicated submit with
 * the same key returns the original result instead of creating a second
 * school/subscription/invite/job — including the concurrent-double-submit
 * race, caught via the same P2002-then-requery pattern used by
 * src/lib/jobs.ts createJob().
 *
 * Invitation durability: the raw invite token is NOT generated here and
 * never persisted (only its hash ever is — see src/lib/invite-tokens.ts).
 * Instead this transaction only creates the durable BackgroundJob row; the
 * caller (the route handler) is expected to attempt delivery immediately via
 * runInviteEmailDeliveryInline (src/lib/job-handlers.ts) right after commit.
 * If the process crashes before/during that attempt, the job row survives
 * the crash and the standalone worker delivers it instead — see
 * tests/invite-email-delivery.test.ts for the crash-simulation proof.
 *
 * IMPORTANT: this module deliberately does NOT send the invite email itself
 * (see tests/email-iam-mapping.test.ts) — sendStaffInviteEmail call sites
 * are confined to src/app and src/lib/job-handlers.ts (the only src/lib file
 * that runs exclusively inside the SES-permitted web task's process).
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";
import { slugify } from "@/lib/utils";
import { inviteEmailDeliveryPayloadSchema } from "@/lib/jobs";
import { applyPlanFeatureTemplate } from "@/lib/plan-catalogue";
import type { School, SchoolInvite, BackgroundJob } from "@/generated/prisma/client";

export const createSchoolWithAdminSchema = z.object({
  // Client-generated (crypto.randomUUID()) once per form session — resent
  // unchanged on every retry of the SAME submit attempt.
  idempotencyKey: z.string().trim().min(8).max(200),
  name: z.string().trim().min(2, "School name is required"),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  website: z.string().trim().optional(),
  planId: z.string().min(1, "Select a plan"),
  adminName: z.string().trim().min(2, "Admin name is required"),
  adminEmail: z.string().trim().email("A valid admin email is required"),
});
export type CreateSchoolWithAdminInput = z.infer<typeof createSchoolWithAdminSchema>;

export type CreateSchoolWithAdminResult =
  | {
      ok: true;
      deduplicated: boolean;
      school: School;
      invite: SchoolInvite;
      plan: { id: string; name: string };
      /**
       * Null on a deduplicated replay (nothing new was created, so there is
       * no fresh job to deliver). Non-null on a fresh creation — the caller
       * MUST attempt runInviteEmailDeliveryInline(deliveryJobId) right after
       * commit to get the invite link back in the same response; the
       * durable job guarantees delivery even if that attempt is lost to a
       * crash.
       */
      deliveryJobId: string | null;
    }
  | { ok: false; code: "PLAN_NOT_FOUND" | "PLAN_INACTIVE" | "VALIDATION"; error: string };

async function findByIdempotencyKey(idempotencyKey: string) {
  return prisma.school.findUnique({
    where: { creationIdempotencyKey: idempotencyKey },
    include: { invites: { where: { role: "SCHOOL_ADMIN" }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
}

export async function createSchoolWithAdmin(
  input: CreateSchoolWithAdminInput,
  founderId: string
): Promise<CreateSchoolWithAdminResult> {
  const adminEmail = input.adminEmail.trim().toLowerCase();

  const existing = await findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    const invite = existing.invites[0];
    const plan = invite?.planId ? await prisma.subscriptionPlan.findUnique({ where: { id: invite.planId }, select: { id: true, name: true } }) : null;
    return { ok: true, deduplicated: true, school: existing, invite, plan: plan ?? { id: "", name: "" }, deliveryJobId: null };
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan) return { ok: false, code: "PLAN_NOT_FOUND", error: "Selected plan was not found" };
  if (!plan.isActive) return { ok: false, code: "PLAN_INACTIVE", error: "Selected plan is not active" };

  let slug = slugify(input.name);
  const slugTaken = await prisma.school.findUnique({ where: { slug }, select: { id: true } });
  if (slugTaken) slug = `${slug}-${Date.now()}`;

  const isTrial = plan.slug === "trial";
  const trialStartDate = isTrial ? new Date() : null;
  const trialExpiryDate = isTrial ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
  const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  let result: { school: School; invite: SchoolInvite; job: BackgroundJob };
  try {
    result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: input.name,
          slug,
          address: input.address || null,
          phone: input.phone || null,
          email: input.email || null,
          website: input.website || null,
          creationIdempotencyKey: input.idempotencyKey,
        },
      });

      await tx.schoolSubscription.create({
        data: {
          schoolId: school.id,
          planId: plan.id,
          billingCycle: "MONTHLY",
          amount: plan.priceMonthly,
          currentPeriodEnd: trialExpiryDate,
        },
      });

      await applyPlanFeatureTemplate(tx, school.id, plan.enabledFeatures);

      // tokenHash is intentionally left unset (null): the raw token is
      // minted only at actual send time by the INVITE_EMAIL_DELIVERY job
      // handler (src/lib/job-handlers.ts) — never generated or persisted
      // here — so there is nothing sensitive to lose if this process
      // crashes right after this transaction commits.
      const invite = await tx.schoolInvite.create({
        data: {
          name: input.adminName,
          email: adminEmail,
          role: "SCHOOL_ADMIN",
          schoolId: school.id,
          invitedById: founderId,
          expiresAt: inviteExpiresAt,
          planId: plan.id,
          billingCycle: "MONTHLY",
          trialStartDate,
          trialExpiryDate,
        },
      });

      // Durable outbox record, created ATOMICALLY with the school/
      // subscription/invite above: this is what guarantees the invite email
      // is never permanently lost to a crash (see the module header comment
      // and tests/invite-email-delivery.test.ts).
      const payload = inviteEmailDeliveryPayloadSchema.parse({ inviteId: invite.id });
      const job = await tx.backgroundJob.create({
        data: {
          type: "INVITE_EMAIL_DELIVERY",
          schoolId: school.id,
          createdById: founderId,
          payload,
          totalItems: 1,
          payloadFingerprint: invite.id,
          status: "PENDING",
        },
      });

      return { school, invite, job };
    });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      // Concurrent duplicate submit won the race on creationIdempotencyKey —
      // re-query and return the winner's result instead of failing.
      const winner = await findByIdempotencyKey(input.idempotencyKey);
      if (winner) {
        const invite = winner.invites[0];
        return { ok: true, deduplicated: true, school: winner, invite, plan: { id: plan.id, name: plan.name }, deliveryJobId: null };
      }
    }
    throw error;
  }

  const { school, invite, job } = result;
  return { ok: true, deduplicated: false, school, invite, plan: { id: plan.id, name: plan.name }, deliveryJobId: job.id };
}
