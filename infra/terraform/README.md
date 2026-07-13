# SchoolSync staging infrastructure (Terraform)

Provisions the AWS staging environment described in the project's target
architecture: ALB -> ECS Fargate (web + worker) -> RDS PostgreSQL +
ElastiCache Valkey + S3, all in `ap-south-1`. See the repo-root deployment
report for the full findings/decisions writeup; this file covers day-to-day
operation.

## Layout

| File | Purpose |
|---|---|
| `versions.tf` | Terraform/provider version pins, partial S3 backend |
| `variables.tf` | All inputs — every one has a doc comment |
| `vpc.tf` | VPC, public subnets (ALB+ECS), isolated subnets (RDS/ElastiCache) |
| `security-groups.tf` | ALB / ECS / RDS / Redis security groups |
| `ecr.tf` | **Data source only** — looks up the pre-existing ECR repo |
| `rds.tf` | RDS PostgreSQL (single-AZ, private, encrypted) |
| `elasticache.tf` | ElastiCache Valkey (single-node, TLS + AUTH token) |
| `s3.tf` | Storage bucket + the web task role's scoped S3 policy (no IAM user/access key) |
| `secrets.tf` | One Secrets Manager secret with every app env var (no static S3 credentials) |
| `iam.tf` | ECS execution role (pulls image, reads secrets) + two task roles (`ecs_task_web` with S3 access, `ecs_task_minimal` for worker/migrate) |
| `service-discovery.tf` | Cloud Map private DNS so the worker reaches the web service without going through the public ALB |
| `alb.tf` | Application Load Balancer, target group, HTTP/HTTPS listeners |
| `acm-dns.tf` | Optional ACM cert + Route 53 records (only if a domain is supplied) |
| `ses.tf` | Optional SES domain identity + DKIM (only if `ses_domain` is set) |
| `ecs.tf` | ECS cluster + web/worker/migrate task definitions & services |
| `cloudwatch.tf` | Log groups for web/worker/migrate |
| `outputs.tf` | Everything the `infra/scripts/*.ps1` automation reads |

## First-time setup

```powershell
cd infra/terraform
Copy-Item backend.hcl.example backend.hcl        # fill in your state bucket/table
Copy-Item terraform.tfvars.example terraform.tfvars   # confirm ecr_repository_name at minimum
```

Then run `../scripts/deploy-staging.ps1 -ExpectedAccountId <id> -ImageTag <tag>`
from the repo root (see that script's header comment, or "Coordinated
deployment order" below, for the full flow).

## Why no NAT Gateway by default

ECS tasks (web/worker/migrate) run in **public** subnets with
`assign_public_ip = true`. This gives them outbound internet access (ECR
pull, Secrets Manager, CloudWatch Logs, S3, SES, and third-party APIs like
Resend/Anthropic that have no VPC endpoint) without a NAT Gateway
(~$32-40/mo + per-GB processing). There is no *inbound* path to these tasks
except through the ALB's security group — a public IP alone doesn't open any
ports. RDS and ElastiCache sit in a separate, truly isolated subnet whose
route table has no route to an Internet Gateway or NAT Gateway at all, so
they're unreachable from the internet by construction, not just by security
group. Set `enable_nat_gateway = true` if a stricter "no task should ever
have a public IP" posture is required later (see that variable's doc
comment for what it does and doesn't wire up automatically).

## Why S3 access uses the ECS task role, not an IAM user

`src/lib/storage-s3.ts` resolves S3 credentials via
`resolveS3Credentials(accessKeyId, secretAccessKey)`: both env vars set ->
explicit credentials (local dev), both unset -> `undefined`, so no
`credentials` object is passed to the `S3Client` at all and the AWS SDK's
default provider chain resolves them itself. On ECS Fargate that chain
walks up to the container credential provider, i.e. the task's IAM role —
temporary, auto-rotating, never written to Secrets Manager or anywhere else.
`STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` are therefore never set
on any ECS container.

Only the **web** task role (`aws_iam_role.ecs_task_web`) gets an S3 policy,
scoped to exactly `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on this
bucket's objects — the only operations `storage-s3.ts` actually calls
(`s3:ListBucket` is deliberately not granted; the code never lists
objects). The **worker** and **migrate** tasks use
`aws_iam_role.ecs_task_minimal`, which has no attached policy: the worker
only makes authenticated HTTP calls to the web service, and the migration
task only runs `prisma migrate deploy` against RDS — neither touches the
AWS SDK.

## Why worker -> web traffic doesn't go through the ALB

`scripts/worker.ts` polls `WORKER_INTERNAL_URL` (default
`/api/internal/worker`) with a shared secret. Terraform points that at
`http://web.<project>-<env>.local:3000/api/internal/worker` — a Cloud Map
private DNS name resolvable from anywhere in the VPC — instead of the
public ALB DNS name, so that authenticated-but-internal traffic never
leaves the VPC boundary.

## Why ECS task definitions have `lifecycle { ignore_changes = [container_definitions] }`

Day-to-day image rollouts go through `update-web-service.ps1` /
`update-worker-service.ps1` / `update-migrate-task.ps1`, which register a
new task-definition revision directly via the AWS CLI (via the shared
`Register-EcsTaskDefinitionWithImage` helper in `common.ps1`) and force a
new deployment. Without `ignore_changes`, the next `terraform apply` would
see the live task definition's image differs from `var.image_tag` and
"helpfully" roll it back. Terraform still owns everything else about these
task definitions (CPU/memory, roles, log config, secrets wiring) — only the
container image drifts intentionally.

**This is also why `NODE_EXTRA_CA_CERTS` is baked into the Dockerfile
itself (`ENV NODE_EXTRA_CA_CERTS=...` in the runner stage), not left as
purely an `ecs.tf environment` entry.** `ignore_changes` means `terraform
apply` can never push a new `environment` entry onto an already-registered
task definition, and the update-*.ps1 scripts copy the *currently
registered* container definition forward, patching only `.image` — they
never re-derive `environment` from `ecs.tf`. A variable that only exists in
`ecs.tf`'s `environment` block is therefore only ever applied on a stack's
very first `terraform apply` (before `ignore_changes` has anything to
ignore) and can never reach an already-deployed stack through any
documented rollout path. Baking it into the image instead means every
rollout path inherits it unconditionally, with no dependency on which
script re-registers the revision.

## Coordinated deployment order (`deploy-staging.ps1`)

`deploy-staging.ps1` deliberately does **not** rotate the Secrets Manager
`DATABASE_URL` (which this stack sets to `sslmode=verify-full`) before the
web/worker services are already running a CA-aware image — doing so would
let already-running or freshly-restarted tasks pick up a connection string
requiring full certificate verification with no CA trust configured to
satisfy it. The required order is:

1. Preflight + confirm the image tag exists in ECR and passes the scan gate
   (COMPLETE, zero CRITICAL/HIGH).
2. Register + deploy new web/worker task-definition revisions on the new
   image, **while the OLD secret is still `AWSCURRENT`**.
3. Wait for both services to stabilize; verify liveness only (not
   readiness — the database dependency isn't gated yet).
4. Register a new migrate task-definition revision and keep its exact ARN.
5. `terraform apply` — this is what actually rotates the secret.
6. Run `prisma migrate deploy` using the exact ARN from step 4 (never a
   Terraform output, which is permanently stale — see above).
7. Only if migration succeeds: force-redeploy web/worker so they reload the
   now-`AWSCURRENT` secret, wait for stability, then poll readiness.

The script never retries a failed migration, never seeds data, never
touches DNS, and never points a service at a task-definition ARN it did not
itself just register.

### Rollback after a coordinated rollout

There is **no one-flag automatic rollback** — a rollout past the secret
rotation (step 5 above) touches two independent systems that must be
restored together:

1. **Secrets Manager**: the previous `AWSCURRENT` version id (printed in
   every `deploy-staging.ps1` run's summary, or its failure report if
   migration failed after rotation).
2. **ECS task definitions**: the previous web/worker/migrate
   task-definition ARNs (also printed in the same report).

Restoring only one of the two reintroduces the exact TLS-trust mismatch
this rollout exists to fix (verify-full DATABASE_URL against a task with no
CA trust, or CA-aware tasks pointed back at a require-mode secret that
migrations/app code weren't validated against). Manual rollback: restore
the Secrets Manager version with `aws secretsmanager update-secret-version-stage`,
and restore each service with `aws ecs update-service --task-definition
<previous ARN> --force-new-deployment` — do both before considering the
rollback complete. Never print or log the actual secret value while doing
this — only version ids and ARNs are needed.
