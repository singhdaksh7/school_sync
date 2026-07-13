/**
 * Production configuration validation — a REPORTING helper (used by
 * /api/health readiness), not a startup crash gate. Core ERP functionality
 * must never depend on optional/feature-scoped configuration being present;
 * only DATABASE_URL and the auth secret are treated as hard requirements.
 */

import { resolveS3Credentials } from "@/lib/storage-s3";

/**
 * Email is "ok" when the explicit (or defaulted) EMAIL_PROVIDER selection
 * resolves to a real, production-capable provider — mirrors
 * {@link import("@/lib/email").isEmailConfigured}'s contract EXACTLY: true
 * only for ses/resend, same default-to-"ses"-in-production, same
 * no-fallback-between-providers rule. Like isEmailConfigured(), the console
 * dev-logger never counts as "ok" here even outside production — it's a
 * working fallback, not a configured provider. Kept local (same reasoning as
 * isStorageEnvValid below) so this stays a pure function of the injected
 * `env` for testability, without importing email.ts (which would pull in the
 * AWS SES / Resend SDKs here too). If you change the selection rules in
 * email.ts, change them here too — tests/email-provider.test.ts and
 * tests/wave-c-config-validation.test.ts both assert this stays in sync.
 */
function isEmailEnvValid(env: NodeJS.ProcessEnv): boolean {
  const isProd = env.NODE_ENV === "production";
  const raw = env.EMAIL_PROVIDER?.trim().toLowerCase() || undefined;
  const selected = raw ?? (isProd ? "ses" : "console");

  if (selected === "ses") return Boolean(env.EMAIL_FROM && (env.SES_REGION || env.STORAGE_REGION));
  if (selected === "resend") return Boolean(env.RESEND_API_KEY);
  return false; // console (never "configured") or an unsupported/invalid value
}

/**
 * Storage is "ok" when bucket+region are set AND the access-key pair is
 * either fully set (explicit local credentials) or fully unset (AWS SDK
 * default credential provider chain, e.g. the ECS task role) — mirrors
 * {@link resolveS3Credentials}'s contract. Kept local (rather than calling
 * storage.ts's isStorageConfigured()) so this stays a pure function of the
 * injected `env`, not the real process.env, for testability.
 */
function isStorageEnvValid(env: NodeJS.ProcessEnv): boolean {
  if (!env.STORAGE_BUCKET || !env.STORAGE_REGION) return false;
  try {
    resolveS3Credentials(env.STORAGE_ACCESS_KEY_ID, env.STORAGE_SECRET_ACCESS_KEY);
    return true;
  } catch {
    return false;
  }
}

export type ConfigCheck = {
  key: string;
  ok: boolean;
  /** REQUIRED: readiness should report degraded/not_ready without it. RECOMMENDED: reported, never blocks readiness. */
  severity: "REQUIRED" | "RECOMMENDED";
  message?: string;
};

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): ConfigCheck[] {
  const checks: ConfigCheck[] = [];
  const add = (key: string, ok: boolean, severity: ConfigCheck["severity"], message: string) =>
    checks.push({ key, ok, severity, message: ok ? undefined : message });

  add("database", Boolean(env.DATABASE_URL), "REQUIRED", "DATABASE_URL is not set");
  add("auth", Boolean(env.NEXTAUTH_SECRET || env.AUTH_SECRET), "REQUIRED", "NEXTAUTH_SECRET/AUTH_SECRET is not set");

  add(
    "storage",
    isStorageEnvValid(env),
    "RECOMMENDED",
    "Object storage is not fully configured — file uploads will fail safe (NotConfiguredStorageProvider)"
  );
  add(
    "distributedRateLimiting",
    Boolean(env.RATE_LIMIT_REDIS_URL && env.RATE_LIMIT_REDIS_TOKEN),
    "RECOMMENDED",
    "Distributed rate limiting is not configured — falls back to a single-instance in-memory limiter"
  );
  add(
    "jobWorker",
    Boolean(env.JOB_WORKER_SECRET),
    "RECOMMENDED",
    "JOB_WORKER_SECRET is not set — large report-card/import batches will be refused (503) rather than silently queued"
  );
  add(
    "email",
    isEmailEnvValid(env),
    "RECOMMENDED",
    "EMAIL_PROVIDER is unset/invalid or its prerequisites aren't met (ses needs EMAIL_FROM + a resolvable region; resend needs RESEND_API_KEY; console is dev-only) — in production, password-reset/invite emails fail safely instead of sending or logging their content"
  );
  add("appBaseUrl", Boolean(env.NEXTAUTH_URL || env.AUTH_URL), "RECOMMENDED", "No app base URL configured — some links fall back to the request origin");
  // AI is intentionally never REQUIRED — it's a per-school opt-in feature
  // (AI_FEATURES), and /api/ai-insights already degrades to 503 cleanly.
  add("ai", Boolean(env.ANTHROPIC_API_KEY), "RECOMMENDED", "ANTHROPIC_API_KEY is not set — AI_FEATURES endpoints return 503 rather than generating insights");

  return checks;
}

/** True only when every REQUIRED check passes — used to decide readiness "ready" vs "degraded", never to crash the process. */
export function requiredConfigReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return validateProductionConfig(env)
    .filter((c) => c.severity === "REQUIRED")
    .every((c) => c.ok);
}
