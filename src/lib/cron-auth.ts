import { timingSafeEqual } from "node:crypto";

/**
 * Auth for the Vercel-Cron-invoked wrapper routes under
 * /api/internal/cron/* (src/app/api/internal/cron/*\/route.ts). Distinct from
 * JOB_WORKER_SECRET (the `x-worker-secret` header checked by
 * /api/internal/worker and /api/internal/maintenance/*): CRON_SECRET is the
 * name Vercel's own Cron Jobs feature recognizes and automatically sends as
 * `Authorization: Bearer <CRON_SECRET>` on every scheduled invocation — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 * Verified here anyway (never trust the platform alone): a request lacking
 * the correct bearer token is rejected before any job/purge logic runs,
 * regardless of who or what sent it.
 */
export function verifyCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
