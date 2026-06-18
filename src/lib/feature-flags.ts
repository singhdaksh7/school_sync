import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_KEYS, type FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

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
