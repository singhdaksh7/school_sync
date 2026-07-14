/**
 * Founder subscription-plan catalogue: validation, stable selectable
 * ordering, and the plan -> school feature-flag template bridge.
 *
 * Money is always derived and stored in BOTH forms: the legacy Decimal
 * columns (priceMonthly/priceAnnual, read by existing UI/invoices) and the
 * canonical integer-minor-unit columns (priceMonthlyMinor/priceAnnualMinor —
 * paise for INR). The minor-unit value is the source of truth; the Decimal
 * value is always derived FROM it (never the other way around) so the two
 * can never drift into different roundings.
 */

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_KEYS, type FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

/** Rounds a rupees-like decimal amount to the nearest integer minor unit (paisa). Throws on negative/non-finite input — callers must validate first via the zod schema. */
export function toMinorUnits(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Amount must be a non-negative finite number");
  }
  return Math.round(amount * 100);
}

export function minorUnitsToDecimalString(minor: number): string {
  return (minor / 100).toFixed(2);
}

// ISO 4217 alphabetic code — 3 uppercase letters. Validated, not free text.
const currencySchema = z.string().trim().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code");

const featureListSchema = z
  .array(z.enum(FEATURE_FLAG_KEYS as unknown as [FeatureFlagKeyValue, ...FeatureFlagKeyValue[]]))
  .max(FEATURE_FLAG_KEYS.length)
  .default([])
  .transform((keys) => Array.from(new Set(keys)));

const nonNegativeIntOrNull = z
  .union([z.number(), z.null()])
  .transform((v) => (v === null ? null : v))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Must be a non-negative whole number or null");

const nonNegativePrice = z.number().finite().nonnegative("Price must be non-negative");

export const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  currency: currencySchema.default("INR"),
  priceMonthly: nonNegativePrice,
  priceAnnual: nonNegativePrice,
  maxStudents: nonNegativeIntOrNull.optional().nullable(),
  staffLimit: nonNegativeIntOrNull.optional().nullable(),
  enabledFeatures: featureListSchema.optional(),
});

// Deliberately NOT createPlanSchema.partial(): several create-schema fields
// (currency, enabledFeatures) carry a `.default(...)`, and zod's `.partial()`
// does not suppress an inner default for an already-optional/defaulted field
// — omitting the field from a PATCH body would still inject "INR" / [] into
// the update payload and silently overwrite whatever the plan already had.
// Every field here is independently optional with NO default, so an omitted
// field is genuinely absent (route only writes keys present in `input`).
export const updatePlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  currency: currencySchema.optional(),
  priceMonthly: nonNegativePrice.optional(),
  priceAnnual: nonNegativePrice.optional(),
  maxStudents: nonNegativeIntOrNull.optional().nullable(),
  staffLimit: nonNegativeIntOrNull.optional().nullable(),
  enabledFeatures: z
    .array(z.enum(FEATURE_FLAG_KEYS as unknown as [FeatureFlagKeyValue, ...FeatureFlagKeyValue[]]))
    .max(FEATURE_FLAG_KEYS.length)
    .transform((keys) => Array.from(new Set(keys)))
    .optional(),
  isActive: z.boolean().optional(),
});
// slug/code is deliberately absent from both schemas — it is derived once at
// creation and is never accepted from the client again (immutable plan code).

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

/** Stable, deterministic ordering for any list a Founder/school-admin picks a plan from — price first, slug as a tiebreaker so ties never reorder between requests. */
export const SELECTABLE_PLAN_ORDER: Prisma.SubscriptionPlanOrderByWithRelationInput[] = [
  { priceMonthly: "asc" },
  { slug: "asc" },
];

/** Active plans only, in stable order — the single source of truth for every "pick a plan" UI (Add School, admin invite). Never returns inactive plans, so callers can never accidentally offer one. */
export function listActivePlans() {
  return prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: SELECTABLE_PLAN_ORDER,
  });
}

/**
 * Applies a plan's `enabledFeatures` template to a newly created school.
 * IMPORTANT: SchoolFeatureFlag is default-ALLOW (absence of a row means the
 * feature is enabled — see src/lib/feature-flags.ts). So the template only
 * ever needs to write explicit `enabled:false` rows for modules the plan
 * excludes; modules the plan includes need no row at all (already the
 * default). Must run inside the same transaction as the school create so a
 * failure never leaves the school without its plan's intended restrictions.
 */
export async function applyPlanFeatureTemplate(
  tx: Prisma.TransactionClient,
  schoolId: string,
  enabledFeatures: FeatureFlagKeyValue[]
): Promise<void> {
  const enabledSet = new Set(enabledFeatures);
  const excluded = FEATURE_FLAG_KEYS.filter((key) => !enabledSet.has(key));
  if (excluded.length === 0) return;
  await tx.schoolFeatureFlag.createMany({
    data: excluded.map((key) => ({ schoolId, key, enabled: false })),
    skipDuplicates: true,
  });
}
