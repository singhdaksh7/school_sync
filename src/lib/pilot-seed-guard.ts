/**
 * Hard safety guard for pilot data generation (seed + scenario runner). Both
 * `scripts/seed-pilot.ts` and `scripts/pilot-verify.ts` call this BEFORE
 * touching the database. Pure/no-DB so it's fully unit-testable — the guard
 * itself must be trustworthy without needing a database to prove it.
 *
 * Refuses to proceed unless ALL of:
 *   - ALLOW_PILOT_SEED=true is explicitly set (nothing runs "by default")
 *   - NODE_ENV is not "production"
 *   - DATABASE_URL does not look like a production host (best-effort — see
 *     PRODUCTION_HOST_HINTS; this is a safety net, not the only control: the
 *     explicit ALLOW_PILOT_SEED flag is the primary gate)
 */

export type PilotSeedGuardResult = { ok: true } | { ok: false; reason: string };

// Heuristic substrings that suggest a connection string points at a real
// managed production database rather than a local/dev/test instance. This is
// intentionally conservative (a false positive just requires overriding
// PILOT_SEED_FORCE_HOST_CHECK, never silently bypassed).
const PRODUCTION_HOST_HINTS = ["neon.tech", "supabase.co", "rds.amazonaws.com", "amazonaws.com", "azure.com", "prod"];

export function checkPilotSeedGuard(env: NodeJS.ProcessEnv = process.env): PilotSeedGuardResult {
  if (env.ALLOW_PILOT_SEED !== "true") {
    return { ok: false, reason: "Refusing to run: set ALLOW_PILOT_SEED=true to explicitly confirm this is a safe dev/test database." };
  }
  if (env.NODE_ENV === "production") {
    return { ok: false, reason: "Refusing to run: NODE_ENV=production." };
  }
  const databaseUrl = (env.DATABASE_URL ?? "").toLowerCase();
  if (!databaseUrl) {
    return { ok: false, reason: "Refusing to run: DATABASE_URL is not set." };
  }
  if (env.PILOT_SEED_FORCE_HOST_CHECK !== "false") {
    const hit = PRODUCTION_HOST_HINTS.find((hint) => databaseUrl.includes(hint));
    if (hit) {
      return {
        ok: false,
        reason: `Refusing to run: DATABASE_URL looks like it may point at a production database (matched "${hit}"). Set PILOT_SEED_FORCE_HOST_CHECK=false only if you are certain this is a disposable dev/test database.`,
      };
    }
  }
  return { ok: true };
}

/** Throws with a clear message if the guard fails — the entrypoint scripts call this and exit(1) on catch. */
export function assertPilotSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const result = checkPilotSeedGuard(env);
  if (!result.ok) throw new Error(result.reason);
}
