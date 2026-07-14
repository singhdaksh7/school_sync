# CI/CD runbook: GitHub Actions + AWS OIDC (staging)

This documents the GitHub-side configuration that **cannot be committed** —
GitHub Environment setup, branch protection, and repository/environment
variables — for the CI/CD foundation added in `.github/workflows/ci.yml` and
`.github/workflows/deploy-staging.yml`, plus the one-time bootstrap of the
two OIDC IAM roles those workflows assume.

Nothing in this document is a secret. Every value named below is a role
ARN, resource name, or non-sensitive configuration value — GitHub
**variables**, never GitHub **secrets**, and never an AWS access key.

## 1. Bootstrap the OIDC roles (one-time, manual, `schoolsync-admin` profile)

Not done by this PR. See `infra/bootstrap/github-oidc/README.md` for the
full runbook — summary:

1. Read-only check: does a `token.actions.githubusercontent.com` OIDC
   provider already exist in account `928805968612`?
2. `terraform init` / `plan` / `apply` under the `schoolsync-admin` SSO
   profile, from `infra/bootstrap/github-oidc/`.
3. Record the two outputs:
   - `github_staging_build_role_arn`
   - `github_staging_deploy_role_arn`

## 2. Create the GitHub Environment `staging`

Repository Settings → Environments → New environment → `staging`.

- **Deployment branches**: restrict to the `staging` branch only.
- **Required reviewers**: add at least one reviewer. Every push to
  `staging` must wait for this approval before the `deploy` job in
  `deploy-staging.yml` runs.
- **Prevent self-review**: enable if your GitHub plan supports it (GitHub
  Enterprise / organization plans) so the person who pushed the triggering
  commit cannot also approve the deployment.
- Do **not** create a `production` environment yet — production is
  explicitly out of scope for this PR (separate role, separate trust
  subject, separate state, separate infrastructure).

## 3. Environment variables on `staging` (not secrets)

Settings → Environments → `staging` → Environment variables:

| Variable | Value | Notes |
|---|---|---|
| `STAGING_DEPLOY_ROLE_ARN` | `arn:aws:iam::928805968612:role/schoolsync-github-staging-deploy` | From bootstrap output `github_staging_deploy_role_arn` |
| `TF_BACKEND_HCL` | exact contents of `infra/terraform/backend.hcl` | Non-secret (bucket/key/region/table names only) |
| `TF_TFVARS` | exact contents of `infra/terraform/terraform.tfvars` | Non-secret (domain names, feature toggles, resource names — no credential belongs in this file; see `infra/terraform/variables.tf`, every `sensitive = true` variable stays empty unless supplied via `TF_VAR_*`, which this workflow never sets) |

`TF_BACKEND_HCL` / `TF_TFVARS` are reconstructed verbatim into
`infra/terraform/backend.hcl` / `terraform.tfvars` at the start of the
`deploy` job (see the "Reconstruct non-secret Terraform backend/tfvars
config" step in `deploy-staging.yml`) — these files are gitignored and
never committed, so the environment variable is the source of truth for
what CI uses. **Keep this in sync with whatever the `schoolsync-admin`
operator's local `backend.hcl` / `terraform.tfvars` already are** — a
mismatch is exactly what the pre-mutation Terraform no-change gate is
designed to catch (the deploy job fails closed rather than silently
deploying against a differently-configured stack).

## 4. Repository variables (not environment-scoped)

Settings → Secrets and variables → Actions → Variables tab (repository
level, not an environment):

| Variable | Value | Notes |
|---|---|---|
| `STAGING_BUILD_ROLE_ARN` | `arn:aws:iam::928805968612:role/schoolsync-github-staging-build` | From bootstrap output `github_staging_build_role_arn`. Used by the `build-and-scan` job, which has no `environment:` (it only pushes/scans images — see the architecture summary for why it doesn't need the Environment gate the deploy job has). |

## 5. Branch protection

Settings → Branches → add rules for both `staging` and `main`:

- Require a pull request before merging, with at least one approving
  review.
- Require status checks to pass before merging — select every job from
  `ci.yml` (`test`, `terraform (infra/terraform)`,
  `terraform (infra/bootstrap/github-oidc)`, `powershell`, `docker`).
- Require branches to be up to date before merging (recommended).
- Do not allow force-pushes or deletions on either branch.

## 6. Fork/Dependabot PR safety

- `ci.yml` never requests `id-token: write` and never calls
  `aws-actions/configure-aws-credentials` — a fork or Dependabot PR gets
  zero AWS access no matter what the PR's diff contains.
- If your organization has "Require approval for all outside
  collaborators" (or similar fork-workflow-approval settings) under
  Settings → Actions → General, leave it enabled — this is an additional,
  independent layer on top of (1) above, not a replacement for it.
- Disable "Allow GitHub Actions to create and approve pull requests" if
  not otherwise needed, to reduce unrelated automation surface.

## 7. What must never be added

- No `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` repository or
  environment **secret**, ever. Both workflows authenticate exclusively via
  OIDC (`aws-actions/configure-aws-credentials` with `role-to-assume`, no
  `aws-access-key-id`/`aws-secret-access-key` inputs).
- No `production` GitHub Environment, no production role ARN variable, no
  production trigger branch — production requires its own separate
  bootstrap (new role names, new trust subjects, new Terraform state, new
  infrastructure) that is explicitly out of scope for this PR.
- No credentials file written to the runner — `infra/scripts/common.ps1`'s
  OIDC mode (`-UseOidcCredentials` / `$env:SCHOOLSYNC_CI_OIDC`) relies
  entirely on the environment-variable credentials
  `aws-actions/configure-aws-credentials` already exports; it never calls
  `aws configure` or writes `~/.aws/credentials`.

## 8. Day-to-day flow once the above is configured

1. A PR against `staging` or `main` runs `ci.yml` — no AWS access, disposable
   Postgres only, full test/typecheck/lint/build/terraform-fmt/validate/
   PowerShell-parse/Docker-build-only coverage.
2. Merging to `staging` triggers `deploy-staging.yml`:
   - `build-and-scan` assumes `schoolsync-github-staging-build`, builds a
     single `linux/amd64` image tagged with the commit SHA, pushes it, and
     gates on the ECR scan (fails on any CRITICAL/HIGH finding).
   - `deploy` waits for the `staging` Environment's required reviewer
     approval, assumes `schoolsync-github-staging-deploy`, reverifies
     account/region/digest, runs the Terraform no-change gate, then runs
     the existing `infra/scripts/deploy-staging.ps1` (unchanged coordinated
     order: register/deploy web+worker → liveness → register the exact
     migrate revision → run migrations → reload services → stability →
     readiness), then verifies image digest/ALB health/logs/follow-up plan
     and writes a sanitized summary.
3. If the Terraform no-change gate ever reports a pending add/change/
   destroy action, the deploy job stops before touching ECS — go run the
   existing manual, reviewed `terraform apply` process
   (`infra/terraform/README.md`) first, then re-run the deploy workflow.

## 9. Manual `workflow_dispatch` re-run

`deploy-staging.yml` also supports `workflow_dispatch`. Dispatching from any
branch other than `staging` is a no-op (`if: github.ref ==
'refs/heads/staging'` on both jobs) — use it to re-run a deployment for the
current `staging` HEAD without needing a new commit, e.g. after fixing a
transient AWS-side issue.
