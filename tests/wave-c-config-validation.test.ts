import { describe, it, expect } from "vitest";
import { validateProductionConfig, requiredConfigReady } from "@/lib/config-validation";
import { getEmailProviderKind, type EmailProviderKind } from "@/lib/email";

const FULL_ENV = {
  DATABASE_URL: "postgresql://x",
  NEXTAUTH_SECRET: "secret",
  STORAGE_BUCKET: "b", STORAGE_REGION: "r", STORAGE_ACCESS_KEY_ID: "k", STORAGE_SECRET_ACCESS_KEY: "s",
  RATE_LIMIT_REDIS_URL: "url", RATE_LIMIT_REDIS_TOKEN: "token",
  JOB_WORKER_SECRET: "secret",
  EMAIL_PROVIDER: "resend", RESEND_API_KEY: "key",
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

  it("storage check is ok with bucket+region only — the ECS task-role/default-credential-provider-chain case", () => {
    const env = { ...FULL_ENV, STORAGE_ACCESS_KEY_ID: undefined, STORAGE_SECRET_ACCESS_KEY: undefined } as unknown as NodeJS.ProcessEnv;
    const storage = validateProductionConfig(env).find((c) => c.key === "storage");
    expect(storage?.ok).toBe(true);
  });

  it("storage check fails when only one access-key env var is set (incomplete pair, not a deliberate task-role setup)", () => {
    const env = { ...FULL_ENV, STORAGE_SECRET_ACCESS_KEY: undefined } as unknown as NodeJS.ProcessEnv;
    const storage = validateProductionConfig(env).find((c) => c.key === "storage");
    expect(storage?.ok).toBe(false);
  });
});

describe("email check (EMAIL_PROVIDER) — mirrors getEmailProviderKind()", () => {
  const emailOk = (env: NodeJS.ProcessEnv) => validateProductionConfig(env).find((c) => c.key === "email")?.ok;

  it("defaults to SES in production, ok only when EMAIL_FROM + region are set", () => {
    expect(emailOk({ NODE_ENV: "production", EMAIL_FROM: "noreply@school.example", STORAGE_REGION: "ap-south-1" } as unknown as NodeJS.ProcessEnv)).toBe(
      true
    );
    expect(emailOk({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("does not fall back to Resend in production when SES is unconfigured, even if RESEND_API_KEY is set (matches getEmailProviderKind)", () => {
    expect(emailOk({ NODE_ENV: "production", RESEND_API_KEY: "re_123" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("resend is ok only when explicitly selected via EMAIL_PROVIDER", () => {
    expect(emailOk({ NODE_ENV: "production", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_123" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(
      emailOk({ NODE_ENV: "production", RESEND_API_KEY: "re_123", EMAIL_FROM: "x@y.com", STORAGE_REGION: "ap-south-1" } as unknown as NodeJS.ProcessEnv)
    ).toBe(true); // EMAIL_PROVIDER unset -> defaults to ses, which IS configured here
  });

  it("console never counts as ok — it's a working dev fallback, not a configured provider (matches isEmailConfigured)", () => {
    expect(emailOk({ NODE_ENV: "development", EMAIL_PROVIDER: "console" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(emailOk({ NODE_ENV: "production", EMAIL_PROVIDER: "console" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("an unsupported EMAIL_PROVIDER value is never ok", () => {
    expect(emailOk({ NODE_ENV: "production", EMAIL_PROVIDER: "sendgrid" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(emailOk({ NODE_ENV: "development", EMAIL_PROVIDER: "sendgrid" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("stays in sync with getEmailProviderKind() across the full matrix — ok iff kind is ses or resend", () => {
    const providers = [undefined, "ses", "resend", "console", "SENDGRID", "  SES  "];
    const nodeEnvs = [undefined, "development", "test", "production"];
    const emailFroms = [undefined, "noreply@school.example"];
    const regions = [undefined, "ap-south-1"];
    const resendKeys = [undefined, "re_123"];

    for (const provider of providers) {
      for (const nodeEnv of nodeEnvs) {
        for (const emailFrom of emailFroms) {
          for (const region of regions) {
            for (const resendKey of resendKeys) {
              const env = {
                NODE_ENV: nodeEnv,
                EMAIL_PROVIDER: provider,
                EMAIL_FROM: emailFrom,
                STORAGE_REGION: region,
                RESEND_API_KEY: resendKey,
              } as unknown as NodeJS.ProcessEnv;

              const kind: EmailProviderKind = getEmailProviderKind(env);
              const expectedOk = kind === "ses" || kind === "resend";
              expect(emailOk(env)).toBe(expectedOk);
            }
          }
        }
      }
    }
  });
});
