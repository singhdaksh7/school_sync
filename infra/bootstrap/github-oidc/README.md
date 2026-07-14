# GitHub OIDC bootstrap (`infra/bootstrap/github-oidc/`)

Creates the GitHub Actions OIDC trust for SchoolSync's `staging` CI/CD:

- `schoolsync-github-staging-build` — assumable only from CI runs on
  `refs/heads/staging` in `singhdaksh7/school_sync`. Push/scan-read on the
  existing `schoolsync` ECR repository only.
- `schoolsync-github-staging-deploy` — assumable only from the GitHub
  Environment subject `repo:singhdaksh7/school_sync:environment:staging`.
  ECS task-definition registration, web/worker service updates + stability
  reads, one-off migration run + result reads, scoped `iam:PassRole` for the
  three existing ECS execution/task roles, and read/lock-only access to the
  staging Terraform backend for the deploy workflow's no-change gate.

This is a **separate Terraform root and a separate state file** from
`infra/terraform` (the staging application stack). It manages account-level
IAM/OIDC trust, not application infrastructure, and is applied far less often
and by a different (narrower) set of people than the application stack.
Never point both roots at the same backend key.

**This stack is not applied as part of the CI/CD PR that introduces it.**
CI only runs `terraform fmt -check`, `init -backend=false`, and `validate`
against this root (no credentials, no plan, no apply — see
`.github/workflows/ci.yml`). Applying it is a one-time, manual,
`schoolsync-admin`-profile operation, described below.

## Prerequisites

- AWS CLI authenticated as the `schoolsync-admin` SSO profile (`aws sso
  login --profile schoolsync-admin`) — the same non-root, SSO-assumed
  identity every `infra/scripts/*.ps1` deployment script requires (see
  `infra/scripts/common.ps1`'s `Assert-AwsAuthenticated`). Never the account
  root user, never a permanent IAM user access key.
- Terraform >= 1.9.0.
- An existing S3 bucket + DynamoDB lock table for Terraform state (the same
  ones `infra/terraform` already uses is fine — just use a different state
  **key**, see `backend.hcl.example`).

## OIDC provider: create or reuse

IAM allows only one `token.actions.githubusercontent.com` OIDC provider per
AWS account. Before running anything here, check (read-only):

```powershell
aws iam list-open-id-connect-providers --profile schoolsync-admin
```

Look for an ARN of the form
`arn:aws:iam::928805968612:oidc-provider/token.actions.githubusercontent.com`.

- **Not listed** — leave `github_oidc_provider_arn` empty (the
  `terraform.tfvars.example` default). `terraform apply` creates it.
- **Already listed** — set `github_oidc_provider_arn` to that exact ARN in
  your `terraform.tfvars`. This stack will then reference it as a plain ARN
  (no `aws_iam_openid_connect_provider` resource is created — see
  `oidc-provider.tf`'s `count` guard) and will never attempt to create a
  duplicate. Confirm its trust details are still what you expect:

  ```powershell
  aws iam get-open-id-connect-provider --open-id-connect-provider-arn <arn> --profile schoolsync-admin
  ```

  If you'd rather this Terraform root take ownership of that existing
  provider (so it appears in this stack's state and plan output), import it
  instead of setting the variable — leave `github_oidc_provider_arn = ""` so
  the resource's `count` stays 1, then:

  ```powershell
  terraform import 'aws_iam_openid_connect_provider.github[0]' <existing-provider-arn>
  ```

  Run `terraform plan` immediately after any import and confirm it reports
  no changes before proceeding.

## Read-only pre-checks (do these before `terraform plan`)

All commands below are read-only (`list`/`get`/`describe`) — none creates,
modifies, or deletes anything.

```powershell
# OIDC provider (see above)
aws iam list-open-id-connect-providers --profile schoolsync-admin

# Role-name collisions — these two names must not already exist for
# anything other than this stack to safely own
aws iam get-role --role-name schoolsync-github-staging-build --profile schoolsync-admin
aws iam get-role --role-name schoolsync-github-staging-deploy --profile schoolsync-admin

# Existing resource ARNs this stack's policies reference (confirm names
# match terraform.tfvars before apply)
aws ecr describe-repositories --repository-names schoolsync --profile schoolsync-admin
aws ecs describe-clusters --clusters schoolsync-staging-cluster --profile schoolsync-admin
aws iam get-role --role-name schoolsync-staging-ecs-execution --profile schoolsync-admin
aws iam get-role --role-name schoolsync-staging-ecs-task-web --profile schoolsync-admin
aws iam get-role --role-name schoolsync-staging-ecs-task-minimal --profile schoolsync-admin

# Staging Terraform state backend the deploy role needs read/lock access to
aws s3api head-bucket --bucket <terraform_state_bucket> --profile schoolsync-admin
aws dynamodb describe-table --table-name <terraform_lock_table> --profile schoolsync-admin
```

If `get-role` for either new role name returns success (i.e. the role
already exists), stop and reconcile manually before applying — this stack
expects to create both roles fresh.

## One-time plan / apply

```powershell
cd infra/bootstrap/github-oidc
Copy-Item backend.hcl.example backend.hcl              # fill in bucket/table
Copy-Item terraform.tfvars.example terraform.tfvars    # fill in/confirm every value

terraform init -backend-config=backend.hcl
terraform validate
terraform plan -var-file=terraform.tfvars -out=tfplan

# Review the plan carefully:
#  - exactly 2 aws_iam_role resources (build, deploy), unless the OIDC
#    provider is also being created (then +1 aws_iam_openid_connect_provider
#    and its tls_certificate data source)
#  - both trust policies show an exact `sub` condition (no "*" anywhere)
#  - no ECS service/cluster/RDS/VPC/ALB resource appears in the plan at all

terraform apply tfplan
```

After apply, record the two outputs and configure them in GitHub (never as
secrets — see the repo-root runbook, "Configuration/runbook"):

```powershell
terraform output github_staging_build_role_arn
terraform output github_staging_deploy_role_arn
```

- `github_staging_build_role_arn` → repository variable `STAGING_BUILD_ROLE_ARN`.
- `github_staging_deploy_role_arn` → **environment** variable
  `STAGING_DEPLOY_ROLE_ARN` on the `staging` GitHub Environment (not a
  repository-level variable — the deploy workflow job runs `environment:
  staging` specifically so it reads the environment-scoped value).

## Wildcard `Resource: "*"` justification (summary)

A handful of AWS actions have no supported resource-level permission at all
(`ecr:GetAuthorizationToken`, `ecs:RegisterTaskDefinition`,
`ecs:DescribeTaskDefinition`) or only support scoping via a condition key
rather than an ARN pattern (`ecs:DescribeTasks`/`ecs:ListTasks` via
`ecs:cluster`). The deploy role's Terraform-plan read-refresh statement
(`TerraformPlanReadOnlyRefresh` in `iam-deploy-role.tf`) is the largest of
these: a real `terraform plan` against the staging stack's ~20 `.tf` files
must read every resource type it manages (VPC, ALB, RDS, ElastiCache, S3,
Route53/ACM, SES, CloudWatch, Cloud Map) to detect drift, and most of those
services' Describe/List/Get actions don't support resource-level IAM
conditions. Every action in that statement is a read verb — see the inline
comment on that statement for the full reasoning, and `secretsmanager:
GetSecretValue` is never granted anywhere in this stack.

## What this stack deliberately does NOT do

- Does not create, modify, or delete the ECR repository, ECS cluster/
  services, RDS, ElastiCache, VPC, ALB, security groups, Route53, ACM, SES,
  or Secrets Manager secret — those stay owned by `infra/terraform` and its
  manual, reviewed `terraform apply` process.
- Does not grant either role `secretsmanager:GetSecretValue`,
  `iam:CreateRole`/`DeleteRole`/`PutRolePolicy`/`AttachRolePolicy` on
  anything, or any RDS/ElastiCache/VPC/ALB/security-group write action.
- Does not enable a production environment, role, or trust subject —
  production requires its own separate bootstrap (new role names, new trust
  subjects, new state, new infrastructure) and is explicitly out of scope
  here.
- Is never applied by any GitHub Actions workflow — only `fmt -check`,
  `init -backend=false`, and `validate` run in CI (no AWS credentials
  involved in any of those three).
