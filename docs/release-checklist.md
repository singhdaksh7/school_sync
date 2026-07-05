# Backend Release Checklist

Run before every deploy that includes backend/schema changes. "Automated"
items are commands to run; "Manual" items require a human judgment call.

| Check | Automated / Manual | How |
|---|---|---|
| No `@ts-ignore` introduced for this release | Manual | `git diff main --stat` then grep the diff for `@ts-ignore`/`@ts-expect-error` |
| Lint errors zero | Automated | `npm run lint` |
| Tests green | Automated | `npm test` |
| Build green | Automated | `npm run build` |
| Worker typecheck green | Automated | `npm run worker:typecheck` |
| Pilot scripts typecheck green | Automated | `npm run scripts:typecheck` |
| Prisma schema valid | Automated | `npx prisma validate` |
| Prisma client generates | Automated | `npx prisma generate` |
| Migration status checked against target DB | Manual | `npx prisma migrate status` (never assume) |
| Feature route audit green | Automated | part of `npm test` (`tests/feature-route-enforcement.test.ts`) |
| No raw DB credentials in repo | Manual | confirm `.env` is gitignored; `.env.example` has placeholders only |
| No secrets in logs | Manual | grep new `console.log`/`console.error` calls in the diff for tokens/passwords/keys |
| Health endpoint safe | Manual | confirm `/api/health?check=readiness` returns booleans/enums only, no connection strings |
| Public file access reviewed | Manual | confirm only `BRANDING_IMAGE` (PUBLIC visibility) is unauthenticated |
| Private file access tenant-scoped | Manual | `/api/files/[fileId]` resolves visibility/ownership before ever returning a URL |
| Custom domain only VERIFIED resolves | Automated | `tests/wave-c-custom-domain.test.ts` |
| Lifecycle enforcement tests green | Automated | `tests/tenant-access.test.ts`, `tests/wave-c-pilot-matrix.test.ts` |
| SaaS billing recovery tests green | Automated | `tests/financial-domain-separation.test.ts` |
| Retired Razorpay student routes remain 410/retired | Manual | confirm `/api/webhooks/razorpay` and `/api/parent/fees/{create-order,verify-payment}` still return their retired response |
| Student-fee webhook cannot mutate the ledger | Manual | confirm the retired webhook route has no Prisma write |
| Job worker configured before accepting large production jobs | Automated (guard) + Manual (env) | `isJobWorkerConfigured()` guard is in both job-creating routes; confirm `JOB_WORKER_SECRET` is actually set in the deploy environment |
| Distributed rate limiter configured | Manual | confirm `RATE_LIMIT_REDIS_URL`/`RATE_LIMIT_REDIS_TOKEN` set for a multi-instance deploy |
| Storage configured | Manual | confirm all four `STORAGE_*` vars set |
| Email sender config valid | Manual | confirm `RESEND_API_KEY`/`RESEND_FROM_EMAIL` if email flows are relied on |
| Founder access reviewed | Manual | confirm no new route accidentally bypasses `requireFounderSession` |
| Production seed guard verified | Automated | `tests/wave-c-pilot-seed-guard.test.ts`; confirm `ALLOW_PILOT_SEED` is unset/false in production env |

## Suggested command sequence

```
npx prisma validate
npx prisma generate
npm run lint
npm test
npm run build
npm run worker:typecheck
npm run scripts:typecheck
npx prisma migrate status   # against the actual target DB — never skip
```
