import { describe, it, expect } from "vitest";
import { validateProductionConfig, requiredConfigReady } from "@/lib/config-validation";

const FULL_ENV = {
  DATABASE_URL: "postgresql://x",
  NEXTAUTH_SECRET: "secret",
  STORAGE_BUCKET: "b", STORAGE_REGION: "r", STORAGE_ACCESS_KEY_ID: "k", STORAGE_SECRET_ACCESS_KEY: "s",
  RATE_LIMIT_REDIS_URL: "url", RATE_LIMIT_REDIS_TOKEN: "token",
  JOB_WORKER_SECRET: "secret",
  RESEND_API_KEY: "key",
  NEXTAUTH_URL: "https://app.example.com",
  ANTHROPIC_API_KEY: "key",
} as unknown as NodeJS.ProcessEnv;

describe("production config validation", () => {
  it("reports every check as ok when fully configured", () => {
    const checks = validateProductionConfig(FULL_ENV);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("requiredConfigReady is true only when DATABASE_URL and auth secret are present", () => {
    expect(requiredConfigReady(FULL_ENV)).toBe(true);
    expect(requiredConfigReady({ ...FULL_ENV, DATABASE_URL: undefined })).toBe(false);
    expect(requiredConfigReady({ ...FULL_ENV, NEXTAUTH_SECRET: undefined, AUTH_SECRET: undefined })).toBe(false);
  });

  it("does not require optional/feature-scoped config for requiredConfigReady", () => {
    const minimal = { DATABASE_URL: "x", NEXTAUTH_SECRET: "y" } as unknown as NodeJS.ProcessEnv;
    expect(requiredConfigReady(minimal)).toBe(true);
  });

  it("flags missing storage/rate-limiter/worker/email/AI as RECOMMENDED, never REQUIRED", () => {
    const minimal = { DATABASE_URL: "x", NEXTAUTH_SECRET: "y" } as unknown as NodeJS.ProcessEnv;
    const checks = validateProductionConfig(minimal);
    const notOk = checks.filter((c) => !c.ok);
    expect(notOk.length).toBeGreaterThan(0);
    expect(notOk.every((c) => c.severity === "RECOMMENDED")).toBe(true);
  });
});
