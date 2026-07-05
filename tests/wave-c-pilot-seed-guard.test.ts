import { describe, it, expect } from "vitest";
import { checkPilotSeedGuard, assertPilotSeedAllowed } from "@/lib/pilot-seed-guard";

const SAFE_ENV = {
  ALLOW_PILOT_SEED: "true",
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://test:test@localhost:5432/schoolsync_dev",
} as NodeJS.ProcessEnv;

describe("pilot seed guard — refuses by default", () => {
  it("refuses when ALLOW_PILOT_SEED is not set", () => {
    const result = checkPilotSeedGuard({ ...SAFE_ENV, ALLOW_PILOT_SEED: undefined });
    expect(result.ok).toBe(false);
  });

  it("refuses when ALLOW_PILOT_SEED is any value other than the literal 'true'", () => {
    expect(checkPilotSeedGuard({ ...SAFE_ENV, ALLOW_PILOT_SEED: "1" }).ok).toBe(false);
    expect(checkPilotSeedGuard({ ...SAFE_ENV, ALLOW_PILOT_SEED: "yes" }).ok).toBe(false);
  });

  it("refuses when NODE_ENV=production, even with the flag set", () => {
    const result = checkPilotSeedGuard({ ...SAFE_ENV, NODE_ENV: "production" });
    expect(result.ok).toBe(false);
  });

  it("refuses when DATABASE_URL is unset", () => {
    const result = checkPilotSeedGuard({ ...SAFE_ENV, DATABASE_URL: undefined });
    expect(result.ok).toBe(false);
  });

  it("refuses when DATABASE_URL looks like a managed production host (Neon)", () => {
    const result = checkPilotSeedGuard({
      ...SAFE_ENV,
      DATABASE_URL: "postgresql://user:pass@ep-icy-cherry-a1fthqxi-pooler.ap-southeast-1.aws.neon.tech/neondb",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses when DATABASE_URL contains 'prod'", () => {
    const result = checkPilotSeedGuard({ ...SAFE_ENV, DATABASE_URL: "postgresql://user:pass@db-prod.internal:5432/schoolsync" });
    expect(result.ok).toBe(false);
  });

  it("allows a safe local/dev database with the flag explicitly set", () => {
    expect(checkPilotSeedGuard(SAFE_ENV)).toEqual({ ok: true });
  });

  it("allows overriding the host heuristic only via an explicit opt-out", () => {
    const prodLike = { ...SAFE_ENV, DATABASE_URL: "postgresql://user:pass@my-prod-lookalike:5432/db" };
    expect(checkPilotSeedGuard(prodLike).ok).toBe(false);
    expect(checkPilotSeedGuard({ ...prodLike, PILOT_SEED_FORCE_HOST_CHECK: "false" }).ok).toBe(true);
  });

  it("assertPilotSeedAllowed throws with a descriptive message on failure", () => {
    expect(() => assertPilotSeedAllowed({ ...SAFE_ENV, ALLOW_PILOT_SEED: undefined })).toThrow(/ALLOW_PILOT_SEED/);
  });

  it("assertPilotSeedAllowed does not throw when the environment is safe", () => {
    expect(() => assertPilotSeedAllowed(SAFE_ENV)).not.toThrow();
  });
});
