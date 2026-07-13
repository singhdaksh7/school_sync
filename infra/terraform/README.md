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

Then run `../scripts/deploy-staging.ps1` from the repo root (see that
script's header comment, or the deployment report, for the full flow).

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
`update-worker-service.ps1`, which register a new task-definition revision
directly via the AWS CLI and force a new deployment. Without
`ignore_changes`, the next `terraform apply` would see the live task
definition's image differs from `var.image_tag` and "helpfully" roll it
back. Terraform still owns everything else about these task definitions
(CPU/memory, roles, log config, secrets wiring) — only the container image
drifts intentionally.
