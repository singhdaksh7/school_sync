/**
 * School deletion retention window — validated, non-secret application
 * configuration (never a hardcoded constant only, per the ticket's
 * "configurable through validated non-secret application configuration").
 */
import { z } from "zod";
import {
  SCHOOL_DELETION_RETENTION_DAYS_DEFAULT,
  SCHOOL_DELETION_RETENTION_DAYS_MIN,
  SCHOOL_DELETION_RETENTION_DAYS_MAX,
} from "@/lib/cost-guard-policy";

const retentionDaysSchema = z.coerce
  .number()
  .int()
  .min(SCHOOL_DELETION_RETENTION_DAYS_MIN)
  .max(SCHOOL_DELETION_RETENTION_DAYS_MAX);

/** Falls back to the documented default on missing/invalid config rather than failing startup. */
export function getSchoolDeletionRetentionDays(): number {
  const raw = process.env.SCHOOL_DELETION_RETENTION_DAYS;
  if (!raw) return SCHOOL_DELETION_RETENTION_DAYS_DEFAULT;
  const parsed = retentionDaysSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      `[school-deletion-config] Invalid SCHOOL_DELETION_RETENTION_DAYS=${JSON.stringify(raw)}, falling back to default ${SCHOOL_DELETION_RETENTION_DAYS_DEFAULT}`
    );
    return SCHOOL_DELETION_RETENTION_DAYS_DEFAULT;
  }
  return parsed.data;
}

export function computeDeletionScheduledFor(now: Date = new Date()): Date {
  return new Date(now.getTime() + getSchoolDeletionRetentionDays() * 24 * 60 * 60 * 1000);
}
