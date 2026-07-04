import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS, type FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

export * from "@/lib/feature-flag-constants";

// Absence of a row means the feature is enabled — existing schools and
// features keep working without any backfill.
export async function getSchoolFeatureFlags(schoolId: string): Promise<Record<FeatureFlagKeyValue, boolean>> {
  const rows = await prisma.schoolFeatureFlag.findMany({
    where: { schoolId },
    select: { key: true, enabled: true },
  });
  const overrides = new Map(rows.map((r) => [r.key, r.enabled]));

  const result = {} as Record<FeatureFlagKeyValue, boolean>;
  for (const key of FEATURE_FLAG_KEYS) {
    result[key] = overrides.get(key) ?? true;
  }
  return result;
}

export async function isFeatureEnabled(schoolId: string, key: FeatureFlagKeyValue): Promise<boolean> {
  const row = await prisma.schoolFeatureFlag.findUnique({
    where: { schoolId_key: { schoolId, key } },
    select: { enabled: true },
  });
  return row?.enabled ?? true;
}

/**
 * Server-side module gate. Returns a 403 NextResponse when the school's plan has
 * the module disabled, or null to continue. Call AFTER the route's auth/tenant
 * check so feature state is never revealed to unauthorized callers.
 *
 * NOTE: this gates plan MODULE access. It must never be applied to the Founder
 * routes that configure feature flags — those are platform-admin, not school,
 * routes (and are separately gated by requireFounderSession + the proxy).
 */
export async function requireSchoolFeature(
  schoolId: string,
  key: FeatureFlagKeyValue
): Promise<NextResponse | null> {
  if (await isFeatureEnabled(schoolId, key)) return null;
  return NextResponse.json(
    { error: `${FEATURE_FLAG_LABELS[key]} is not enabled for this school's plan` },
    { status: 403 }
  );
}
