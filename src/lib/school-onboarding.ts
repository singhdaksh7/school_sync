/**
 * Founder "Add School" onboarding: creates the school, its subscription
 * (plan assignment), and the initial admin invitation as ONE atomic,
 * idempotent operation. Replaces the previous two-step flow (bare school via
 * POST /api/schools, then a separate InviteAdminClient call) that let a
 * school exist indefinitely with no plan and no invited admin.
 *
 * Idempotency: the caller supplies a client-generated `idempotencyKey`
 * (School.creationIdempotencyKey, unique). A retried/duplicated submit with
 * the same key returns the original result instead of creating a second
 * school/subscription/invite — including the concurrent-double-submit race,
 * caught via the same P2002-then-requery pattern used by src/lib/jobs.ts
 * createJob().
 *
 * IMPORTANT: this module deliberately does NOT send the invite email itself
 * (see tests/email-iam-mapping.test.ts) — sendStaffInviteEmail call sites
 * must live under src/app only, since only the web ECS task role has SES
 * permission (the worker/migrate roles don't). The caller (the route
 * handler) sends the email using the rawInviteToken this returns.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";
import { slugify } from "@/lib/utils";
import { generateInviteToken } from "@/lib/invite-tokens";
import { applyPlanFeatureTemplate } from "@/lib/plan-catalogue";
import type { School, SchoolInvite } from "@/generated/prisma/client";

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
      /** Null on a deduplicated replay — the raw token is never persisted/re-derivable; the route's caller should direct the Founder to the invite-resend action instead. */
      rawInviteToken: string | null;
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
    return { ok: true, deduplicated: true, school: existing, invite, plan: plan ?? { id: "", name: "" }, rawInviteToken: null };
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
  const { rawToken, tokenHash } = generateInviteToken();

  let result: { school: School; invite: SchoolInvite };
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
          tokenHash,
        },
      });

      return { school, invite };
    });
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      // Concurrent duplicate submit won the race on creationIdempotencyKey —
      // re-query and return the winner's result instead of failing.
      const winner = await findByIdempotencyKey(input.idempotencyKey);
      if (winner) {
        const invite = winner.invites[0];
        return { ok: true, deduplicated: true, school: winner, invite, plan: { id: plan.id, name: plan.name }, rawInviteToken: null };
      }
    }
    throw error;
  }

  const { school, invite } = result;
  return { ok: true, deduplicated: false, school, invite, plan: { id: plan.id, name: plan.name }, rawInviteToken: rawToken };
}
