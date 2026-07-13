import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isStorageConfigured } from "@/lib/storage";
import { getRateLimiterKind, isDistributedRateLimiterConfigured } from "@/lib/rate-limit";
import { isJobWorkerConfigured } from "@/lib/jobs";
import { requiredConfigReady } from "@/lib/config-validation";
import { isEmailConfigured, getEmailProviderKind } from "@/lib/email";

/**
 * Health endpoint.
 *
 * LIVENESS (default): cheap, dependency-free "the process is up" — safe to poll
 * frequently. Never touches the database or any secret.
 *
 * READINESS (`?check=readiness`): reports whether required production
 * dependencies are usable — DB connectivity, durable storage, a distributed
 * rate-limiter, and job-worker configuration. It returns booleans/enums ONLY;
 * it never exposes connection strings, hostnames, credentials, user data, or
 * stack traces, and it is NOT a login/credential oracle.
 *
 * Three-state contract:
 *   READY    — database up, and (dev/test, or in prod: distributed rate
 *              limiting + storage + job worker are ALL configured).
 *   DEGRADED — database up, but in production one or more of
 *              storage/rate-limiter/job-worker is missing. Normal CRUD still
 *              works; upload and batch-job routes independently refuse to
 *              accept work they can never fulfil (see file-service.ts /
 *              jobs.ts callers) rather than silently queuing stuck work.
 *   NOT_READY — database is unreachable; nothing reliably works.
 */
const startedAt = Date.now();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const check = searchParams.get("check");

  if (check !== "readiness") {
    return NextResponse.json({
      status: "ok",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  }

  // ── Readiness ──────────────────────────────────────────────────────────────
  let database: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  const rateLimiterKind = getRateLimiterKind();
  const distributedRateLimiting = isDistributedRateLimiterConfigured();
  const storageConfigured = isStorageConfigured();
  const jobWorkerConfigured = isJobWorkerConfigured();
  // Email/AI are feature-scoped, never block readiness — reported for
  // operational visibility only (see config-validation.ts). emailProvider is
  // a plain kind label ("resend"/"ses"/"console"/"unavailable") — never a
  // secret, address, or credential.
  const emailConfigured = isEmailConfigured();
  const emailProvider = getEmailProviderKind();
  const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  // Custom-domain verification always works when the DB is up — it's a pure
  // DNS TXT lookup (src/lib/custom-domain.ts), no external provider config.
  const customDomainVerificationCapability = database === "up";

  const isProd = process.env.NODE_ENV === "production";
  const productionDependenciesReady = distributedRateLimiting && storageConfigured && jobWorkerConfigured && requiredConfigReady();

  let status: "ready" | "degraded" | "not_ready";
  if (database === "down") {
    status = "not_ready";
  } else if (isProd && !productionDependenciesReady) {
    status = "degraded";
  } else {
    status = "ready";
  }

  return NextResponse.json(
    {
      status,
      checks: {
        database,
        rateLimiter: rateLimiterKind,
        distributedRateLimiting,
        storageConfigured,
        jobWorkerConfigured,
        emailConfigured,
        emailProvider,
        aiConfigured,
        customDomainVerificationCapability,
      },
      timestamp: new Date().toISOString(),
    },
    { status: status === "not_ready" ? 503 : 200 }
  );
}
