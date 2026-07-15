# AWS production and Vercel/Supabase testing

## Intended ownership

| Environment | Source | Runtime | Database | Storage/email/jobs |
|---|---|---|---|---|
| Production | `main` | AWS ECS/Fargate + ALB | Private Amazon RDS PostgreSQL | S3, SES, ElastiCache, Secrets Manager, ECS worker, EventBridge |
| Pull-request testing | PR branch | Vercel Preview | Dedicated Supabase **test** project | Dedicated Supabase test storage/email credentials; never AWS production |

Production must not depend on Vercel, Neon, or Supabase. Preview deployments
must not receive any AWS production role, database URL, bucket credential,
worker secret, SES identity, or production data.

## Safety gates

The production workflow is committed in an inert state. Build and deployment
have independent gates:

1. `PRODUCTION_BUILD_ENABLED=true` permits only the exact `main` SHA to be
   built, pushed to ECR, and scan-gated.
2. `PRODUCTION_DEPLOY_ENABLED=true` permits deployment only after that build;
   leave it false until the application stack is fully verified.
3. Both jobs also require `refs/heads/main`.

The deploy job also uses the protected GitHub Environment `production`. Add a
required reviewer and restrict it to `main`. Do not configure the enable flag
until the application stack and the two production OIDC roles exist and their
fresh Terraform plans are clean.

Routine CI is deliberately unable to apply Terraform. Its deploy role can
refresh/plan state and update existing ECS services/task definitions only. All
infrastructure creation or modification remains a separately reviewed
`schoolsync-admin` operation.

## Phase 1 — configure production OIDC and build the immutable image

Use a separate clean worktree/state. Copy the two
`infra/bootstrap/github-oidc/*production*.example` files to ignored
`backend.hcl` and `terraform.tfvars`.

- Reuse the existing account-level GitHub OIDC provider ARN. Never create a
  second provider.
- Production build trust must be the exact `main` branch subject.
- Production deploy trust must be the exact `production` Environment subject.
- Confirm the plan creates only `schoolsync-github-production-build` and
  `schoolsync-github-production-deploy` plus their inline policies.
- Set `PRODUCTION_BUILD_ROLE_ARN` as a repository variable.
- Set `PRODUCTION_BUILD_ENABLED=true`, dispatch the workflow, and confirm the
  exact reviewed `main` SHA exists in ECR with zero critical/high findings.
- Keep `PRODUCTION_DEPLOY_ENABLED=false`; the deploy job must remain skipped.

## Phase 2 — create AWS without changing production traffic

Use a clean worktree at the reviewed `main` SHA. Never reuse staging state.

1. Copy `infra/terraform/backend.production.hcl.example` to the ignored
   `backend.hcl` and `production.tfvars.example` to ignored
   `terraform.tfvars`.
2. Replace every `REPLACE_...` value and set `image_tag` to the exact full
   reviewed `main` SHA. Do not place credentials in either file.
3. Keep `manage_domain_dns_record=false` and
   `enable_maintenance_schedules=false`.
4. Run `terraform init`, `terraform validate`, and save a binary plan.
5. Review the plan JSON. It must create only `schoolsync-production-*`
   resources and the `aws-production.zipinnovate.com` verification alias. It
   must not update/destroy staging or the current `www`/apex records.
6. Apply the exact saved plan with the non-root SSO admin profile.
7. Deploy the exact image and verify liveness/readiness through Terraform's
   `verification_url`, with normal DNS and verified TLS.

Production guardrails make planning fail unless ECS uses private subnets plus
NAT, RDS uses Multi-AZ/deletion protection/final snapshots/at least seven days
of backups, Valkey uses Multi-AZ, the public URL is HTTPS, and SES is selected.

- Set `PRODUCTION_DEPLOY_ROLE_ARN`, `TF_BACKEND_HCL`, `TF_TFVARS`, and
  `PRODUCTION_VERIFY_URL` on the protected `production` Environment.
- Neither `TF_BACKEND_HCL` nor `TF_TFVARS` may contain secrets.

## Phase 3 — Vercel Preview + Supabase test isolation

`vercel.json` disables automatic deployment for `main`; other branches remain
eligible for previews. In Vercel, scope all test values to **Preview** only:

- `DATABASE_URL`: Supabase transaction/session pooler appropriate to the app.
- `DIRECT_URL`: Supabase direct/session connection for Prisma migrations.
- Independent `NEXTAUTH_SECRET`/`AUTH_SECRET`, `JOB_WORKER_SECRET`, and
  `CRON_SECRET` test values.
- A separate Supabase Storage test bucket through its S3-compatible endpoint:
  `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, and the server-only
  S3 access-key pair.
- A test-only email sender/provider. Never send real school invitations from
  previews.

Supabase S3 access keys bypass Storage RLS and can access all buckets in their
project. Therefore use a dedicated test project, keep the keys server-only,
and never reuse its credentials or data in production.

## Phase 4 — production data migration

This is a separate, explicitly approved maintenance-window operation. Do not
run it from a PR or ordinary deployment workflow.

1. Reconcile migration history first, including the two historical migration
   directories already recorded in the current Neon database but missing from
   `main`.
2. Take a source backup and record a PII-free manifest (schema version, table
   counts, dump checksum, start/end timestamps).
3. Put the old production application in maintenance/read-only mode so writes
   cannot diverge during the final copy.
4. Restore into private RDS through a reviewed one-off task inside the VPC.
   Never make RDS public and never print either database URL.
5. Run `prisma migrate status`, FK/integrity checks, aggregate table counts,
   authenticated Founder smoke tests, job tests, S3 tests, and SES delivery.
6. Keep the source backup and old Vercel deployment unchanged for rollback.

## Phase 5 — traffic cutover

Only after Phase 4 succeeds:

1. Save and review a Terraform plan changing
   `manage_domain_dns_record=false` to `true`. Its DNS portion must change only
   the intended `www.zipinnovate.com` and apex `zipinnovate.com` aliases.
   The ALB must redirect apex HTTPS requests to `www` without Vercel.
2. Apply, then verify normal DNS, ACM TLS, ALB targets, liveness, readiness,
   logs, ECS counts, running image digest, RDS, S3, SES, worker, and rollback.
3. Enable `enable_maintenance_schedules=true` in a separate reviewed apply
   after `www` reaches the ALB. Verify both EventBridge targets return success.
4. Set `PRODUCTION_DEPLOY_ENABLED=true` only after a no-change plan passes
   using the production deploy role.
5. Keep the previous Vercel deployment available during the rollback window,
   but remove its production domain and production data credentials after the
   window closes.

Never delete Neon/Vercel data as part of cutover. Decommissioning requires a
separate retention decision and verified AWS backups.
