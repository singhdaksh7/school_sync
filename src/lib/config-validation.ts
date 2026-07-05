/**
 * Production configuration validation — a REPORTING helper (used by
 * /api/health readiness), not a startup crash gate. Core ERP functionality
 * must never depend on optional/feature-scoped configuration being present;
 * only DATABASE_URL and the auth secret are treated as hard requirements.
 */

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
    Boolean(env.STORAGE_BUCKET && env.STORAGE_REGION && env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY),
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
    Boolean(env.RESEND_API_KEY),
    "RECOMMENDED",
    "RESEND_API_KEY is not set — password-reset/invite emails fall back to console logging, not real delivery"
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
