<#
.SYNOPSIS
  End-to-end SchoolSync staging deployment, coordinated so that CA-aware
  (NODE_EXTRA_CA_CERTS-capable — baked into the image, see Dockerfile) web,
  worker, and migrate task-definition revisions are registered and the
  web/worker services are already running on them BEFORE the Secrets
  Manager DATABASE_URL is ever rotated to `sslmode=verify-full`. Rotating
  the secret first (the previous ordering) let already-running or
  freshly-restarted OLD-revision tasks pick up a connection string
  requiring full certificate verification with no CA trust configured to
  satisfy it — see the deployment-path audit that motivated this rewrite.

  Required order (each step only starts after the previous one verifiably
  succeeded; the script exits non-zero and stops on the first failure,
  never retrying, rolling back, seeding, or touching DNS automatically):

    A. Verify account/region and preflight (read-only).
    B. Confirm the target image tag exists in ECR and passes the scan gate
       (COMPLETE, zero CRITICAL/HIGH).
    C. Register new CA-aware web and worker task-definition revisions and
       deploy them — the OLD sslmode=require secret is still AWSCURRENT
       throughout this step, so already-running connections are undisturbed.
    D. Wait for both ECS services to stabilize.
    E. Verify LIVENESS only (plain /api/health) — DB readiness is not
       required yet, and must not gate the migration step.
    F. Register the CA-aware migrate task-definition revision and retain
       its exact ARN — never resolved from a Terraform output that could be
       stale (infra/terraform/ecs.tf's migrate task definition has
       `lifecycle { ignore_changes = [container_definitions] }`, so
       Terraform's own output permanently points at whatever revision was
       first ever registered). The migrate task FAMILY name (needed to look
       up the currently-registered revision to patch) is derived from
       $previousMigrateArn (STEP B's already-applied
       `ecs_migrate_task_definition_arn` output) rather than the newer
       `ecs_migrate_task_family` output, which STEP G's own `terraform
       apply` is what first creates — this step must never depend on an
       output that doesn't exist in state until after the step that
       follows it.
    G. Run the reviewed `terraform apply` that rotates the Secrets Manager
       secret to a new AWSCURRENT version with DATABASE_URL
       sslmode=verify-full. Does not touch RDS/Redis/VPC/ALB/network — see
       infra/terraform/secrets.tf; every ECS task-definition resource's
       `ignore_changes` means this apply cannot affect the revisions
       registered in steps C/F.
    H. Run `prisma migrate deploy` using the EXACT migrate task-definition
       ARN from step F (never Terraform's stale output).
    I. Only if migration succeeds: force new deployments of the
       already-registered (step C) web/worker revisions so they reload the
       new AWSCURRENT secret.
    J. Wait for both services to stabilize again.
    K. Poll /api/health?check=readiness.
    L. Stop and report if readiness never becomes ready within the timeout
       — this does NOT roll anything back automatically.

  If migration (H) fails AFTER the secret rotation (G): the script stops
  immediately, prints the secret version identifiers and task-definition
  revisions involved (never secret values), and does not touch the
  database, roll back the secret, or roll back any task definition. See
  "COORDINATED ROLLBACK" in the final summary for what a human operator
  must do next — restoring only the secret OR only the task definitions
  reintroduces the exact TLS-trust mismatch this rollout exists to fix.

  Never run automatically by this script: database seeding, DNS changes,
  automatic retries of a failed migration, or updating a service to a
  task-definition ARN this script did not itself just register and verify.

.PARAMETER ExpectedAccountId
  REQUIRED. The AWS account ID you intend to deploy into, sourced
  independently of whatever the AWS CLI happens to be authenticated as
  right now. Compared against the CLI's actual authenticated identity
  immediately after authentication — before any Terraform or AWS mutating
  call — and the script aborts on a mismatch.

.PARAMETER ImageTag
  REQUIRED. The ECR image tag to roll out to web, worker, and migrate.
  Must already be pushed AND have a completed ECR scan — step B verifies
  this itself (zero CRITICAL/HIGH findings required); it does not trust an
  earlier out-of-band scan result.

.PARAMETER AutoApprove
  Skip the interactive confirmation before `terraform apply` (step G).
  Without this switch, the script always pauses for an explicit "yes".

.PARAMETER SkipMigration
  Escape hatch for re-running this script when the last migration already
  succeeded and nothing changed: skips registering/running the migrate
  task (steps F and H) but still performs the secret rotation (G) and the
  final web/worker redeploy (I), since those are still required for the
  new image/secret to actually take effect. Off by default.

.PARAMETER SkipPreflight
  Escape hatch to skip preflight.ps1's read-only AWS resource checks. Off
  by default. Does NOT affect the mandatory -ExpectedAccountId check.

.PARAMETER ScanTimeoutSeconds
  Max time to wait for the ECR scan gate (step B) to reach COMPLETE.

.PARAMETER UseOidcCredentials
  CI/OIDC credential mode. Skips --profile entirely (Assert-AwsAuthenticated
  is called with -Profile "") so the AWS CLI resolves credentials from the
  environment instead — the shape GitHub Actions' OIDC-assumed role
  (aws-actions/configure-aws-credentials) exports. Sets
  $env:SCHOOLSYNC_CI_OIDC = "1" for the lifetime of this process, so every
  script this one invokes in-process (update-migrate-task.ps1,
  run-migrations.ps1) and every common.ps1 helper inherits the same mode
  automatically. Never creates an AWS credentials file on disk. Off by
  default — local interactive usage (schoolsync-admin profile) is
  completely unchanged unless this switch is passed.

.PARAMETER RequireTerraformNoChanges
  CI safety mode. Runs a Terraform `plan -detailed-exitcode` gate against
  the real configured backend BEFORE any ECS mutation (i.e. before STEP C),
  and again in place of STEP G's plan+apply. Continues only on exit code 0
  ("No changes. Your infrastructure matches the configuration."); exits on
  1 (plan error) or 2 (pending add/change/destroy actions). In this mode,
  `terraform apply` is never run — routine CI/CD deployments carry zero
  infrastructure changes by construction, and any real infrastructure
  change must go through the existing manual, reviewed `terraform apply`
  process instead (see infra/terraform/README.md). Off by default — local
  interactive usage (full plan/confirm/apply at STEP G) is unchanged unless
  this switch is passed.

.EXAMPLE
  ./infra/scripts/deploy-staging.ps1 -ExpectedAccountId 928805968612 -ImageTag candidate-<sha>
.EXAMPLE
  ./infra/scripts/deploy-staging.ps1 -ExpectedAccountId 928805968612 -ImageTag candidate-<sha> -AutoApprove
.EXAMPLE
  # GitHub Actions, protected `staging` Environment, OIDC-assumed deploy role:
  ./infra/scripts/deploy-staging.ps1 -ExpectedAccountId 928805968612 -ImageTag $env:GITHUB_SHA -AutoApprove -UseOidcCredentials -RequireTerraformNoChanges
#>
param(
    [Parameter(Mandatory)][string]$ExpectedAccountId,
    [Parameter(Mandatory)][string]$ImageTag,
    [switch]$AutoApprove,
    [switch]$SkipMigration,
    [switch]$SkipPreflight,
    [int]$ScanTimeoutSeconds = 300,
    [switch]$UseOidcCredentials,
    [switch]$RequireTerraformNoChanges
)

if ($UseOidcCredentials) {
    # Must be set BEFORE dot-sourcing common.ps1 so Assert-AwsAuthenticated's
    # default -Profile parameter (evaluated at call time, not at dot-source
    # time) resolves to "" for this process and every script invoked from it.
    $env:SCHOOLSYNC_CI_OIDC = "1"
}

. (Join-Path $PSScriptRoot "common.ps1")

Write-Host "SchoolSync staging deployment" -ForegroundColor Magenta
Write-Host "==============================" -ForegroundColor Magenta

# ── A. Verify account/region and preflight ────────────────────────────────
Write-Step "STEP A: Validating AWS CLI authentication ($(if ($UseOidcCredentials) { 'OIDC/environment credentials' } else { 'non-root, SSO-assumed role required' }))"
$identity = Assert-AwsAuthenticated
$profileArgs = Get-AwsCliProfileArgs

Write-Step "STEP A: Confirming AWS account matches -ExpectedAccountId"
if ($identity.Account -ne $ExpectedAccountId) {
    Write-Fail "Authenticated AWS account ($($identity.Account)) does not match -ExpectedAccountId ($ExpectedAccountId)."
    Write-Fail "Refusing to deploy — this is very likely the wrong AWS profile/credentials. Aborting before any change."
    exit 1
}
Write-Success "Authenticated account matches -ExpectedAccountId ($($identity.Account))"

Write-Step "STEP A: Validating Terraform availability"
Assert-TerraformAvailable
$backendConfig = Assert-BackendConfigExists

if (-not $SkipPreflight) {
    Write-Step "STEP A: Running AWS prerequisite preflight"
    # Hashtable splatting (@hashtable), NOT array splatting (@array): an
    # array of alternating "-ParamName"/value strings binds POSITIONALLY —
    # PowerShell never re-parses splatted array elements as named-parameter
    # tokens, so "-ExpectedAccountId" itself would bind as preflight.ps1's
    # first positional value and everything after it would shift by one.
    $preflightParams = @{
        ExpectedAccountId = $ExpectedAccountId
        ImageTag          = $ImageTag
    }
    if ($UseOidcCredentials) { $preflightParams["UseOidcCredentials"] = $true }
    & (Join-Path $PSScriptRoot "preflight.ps1") @preflightParams
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Preflight failed — see above. Re-run with -SkipPreflight to bypass (not recommended)."
        exit 1
    }
}

if ($RequireTerraformNoChanges) {
    Write-Step "STEP A: CI safety mode — verifying Terraform reports no infrastructure changes before any ECS mutation"
    Assert-TerraformNoChanges -BackendConfig $backendConfig
}

Write-Step "STEP A: Reading Terraform outputs needed before any registration"
$ecrUrl        = Get-TerraformOutputRaw "ecr_repository_url"
$ecrName       = ($ecrUrl -split "/")[-1]
$cluster       = Get-TerraformOutputRaw "ecs_cluster_name"
$webSvc        = Get-TerraformOutputRaw "ecs_web_service_name"
$workerSvc     = Get-TerraformOutputRaw "ecs_worker_service_name"
$webFamily     = Get-TerraformOutputRaw "ecs_web_task_family"
$workerFamily  = Get-TerraformOutputRaw "ecs_worker_task_family"
$secretArn     = Get-TerraformOutputRaw "secrets_manager_secret_arn"
$appUrl        = Get-TerraformOutputRaw "app_url"
$image         = "${ecrUrl}:${ImageTag}"

# ── B. Confirm the final image exists and passes the approved scan gate ───
Write-Step "STEP B: Confirming image and ECR scan gate for ${image}"
$scanResult = Assert-EcrImageApproved -RepositoryName $ecrName -ImageTag $ImageTag -TimeoutSeconds $ScanTimeoutSeconds
Write-Success "Image approved: digest=$($scanResult.Digest) CRITICAL=$($scanResult.Critical) HIGH=$($scanResult.High)"

# Capture BEFORE state for the rollback/audit report — every aws call here
# is read-only and its exit code is checked explicitly.
Write-Step "STEP B: Recording pre-rollout state (previous task definitions, previous secret version)"
$webSvcDesc = aws ecs describe-services --cluster $cluster --services $webSvc @profileArgs --region $env:AWS_REGION --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { Write-Fail "Could not describe web service (exit $LASTEXITCODE)"; exit 1 }
$previousWebArn = $webSvcDesc.services[0].taskDefinition

$workerSvcDesc = aws ecs describe-services --cluster $cluster --services $workerSvc @profileArgs --region $env:AWS_REGION --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { Write-Fail "Could not describe worker service (exit $LASTEXITCODE)"; exit 1 }
$previousWorkerArn = $workerSvcDesc.services[0].taskDefinition

$previousMigrateArn = Get-TerraformOutputRaw "ecs_migrate_task_definition_arn"
$previousSecretVersionId = Get-SecretCurrentVersionId -SecretId $secretArn
Write-Success "Previous web=$previousWebArn worker=$previousWorkerArn migrate=$previousMigrateArn secretVersion=$previousSecretVersionId"

# ── C. Register CA-aware web/worker revisions and deploy them WHILE the
#      old sslmode=require secret is still AWSCURRENT ─────────────────────
Write-Step "STEP C: Registering + deploying CA-aware web task revision"
$newWebArn = Update-EcsServiceImage -Cluster $cluster -Service $webSvc -Family $webFamily -ContainerName "web" -ImageUri $image
# Re-validated here (Update-EcsServiceImage already validates internally)
# because THIS is the exact variable STEP I later splats into a mutating
# `--task-definition` argument — catching any pollution as early as
# possible, before steps D-H run at all, not just before STEP I's own call.
$newWebArn = Assert-SingleEcsTaskDefinitionArn -Value $newWebArn -ExpectedFamily $webFamily

Write-Step "STEP C: Registering + deploying CA-aware worker task revision"
$newWorkerArn = Update-EcsServiceImage -Cluster $cluster -Service $workerSvc -Family $workerFamily -ContainerName "worker" -ImageUri $image
$newWorkerArn = Assert-SingleEcsTaskDefinitionArn -Value $newWorkerArn -ExpectedFamily $workerFamily

# ── D. Both services are already confirmed stable — Update-EcsServiceImage
#      waits internally (aws ecs wait services-stable) before returning. ──
Write-Success "STEP D: web and worker services stable on CA-aware revisions"

# ── E. Verify LIVENESS only — DB readiness must not gate migration ────────
Write-Step "STEP E: Verifying liveness only (GET $appUrl/api/health)"
try {
    $liveResp = Invoke-WebRequest -Uri "$appUrl/api/health" -UseBasicParsing -TimeoutSec 15
    if ([int]$liveResp.StatusCode -ne 200) {
        Write-Fail "Liveness check returned HTTP $([int]$liveResp.StatusCode) — expected 200. Aborting before migration/secret rotation."
        exit 1
    }
    Write-Success "Liveness OK (HTTP 200)"
} catch {
    Write-Fail "Liveness check request failed: $_"
    exit 1
}

# ── F. Register the CA-aware migrate task revision and retain its ARN ─────
$newMigrateArn = $null
if (-not $SkipMigration) {
    Write-Step "STEP F: Registering CA-aware migrate task revision"
    $migrateFamily = Get-EcsTaskFamilyFromArn -TaskDefinitionArn $previousMigrateArn
    $newMigrateArn = & (Join-Path $PSScriptRoot "update-migrate-task.ps1") -ImageTag $ImageTag -Family $migrateFamily | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0 -or -not $newMigrateArn) {
        Write-Fail "Failed to register the migrate task revision (exit $LASTEXITCODE) — aborting BEFORE any secret rotation."
        Write-Fail "No changes beyond the already-deployed web/worker revisions (step C) were made."
        exit 1
    }
    $newMigrateArn = Assert-SingleEcsTaskDefinitionArn -Value $newMigrateArn -ExpectedFamily $migrateFamily
    Write-Success "Migrate task revision registered: $newMigrateArn"
} else {
    Write-Warn "STEP F: -SkipMigration set — not registering a migrate task revision."
}

# ── G. Terraform plan/apply — rotates the Secrets Manager AWSCURRENT
#      version to DATABASE_URL sslmode=verify-full. Every ECS task
#      definition resource has `ignore_changes = [container_definitions]`,
#      so this cannot affect the revisions registered in steps C/F. In
#      -RequireTerraformNoChanges mode (CI), this step never applies —
#      routine CI/CD deployments carry zero infrastructure changes by
#      construction, so it only re-verifies that with a no-change plan. ───
if ($RequireTerraformNoChanges) {
    Write-Step "STEP G: CI safety mode — re-verifying no infrastructure changes (terraform apply will NOT run)"
    Assert-TerraformNoChanges -BackendConfig $backendConfig
    Write-Warn "STEP G: -RequireTerraformNoChanges is set — skipping terraform apply. No secret rotation occurs in this mode."
} else {
    Push-Location $TerraformDir
    try {
        Write-Step "STEP G: Running terraform fmt"
        terraform fmt -recursive | Out-Null
        Write-Success "Formatted"

        Write-Step "STEP G: Running terraform init"
        Invoke-Checked -FilePath "terraform" -ArgumentList @("init", "-backend-config=$backendConfig", "-input=false") `
            -FailureMessage "terraform init failed"

        Write-Step "STEP G: Running terraform validate"
        Invoke-Checked -FilePath "terraform" -ArgumentList @("validate") -FailureMessage "terraform validate failed"

        Write-Step "STEP G: Running terraform plan"
        $planArgs = @("plan", "-out=tfplan", "-input=false")
        if (Test-Path "terraform.tfvars") { $planArgs += "-var-file=terraform.tfvars" }
        Invoke-Checked -FilePath "terraform" -ArgumentList $planArgs -FailureMessage "terraform plan failed"

        if (-not $AutoApprove) {
            Write-Host ""
            Write-Host "Review the plan above. This applies the DATABASE_URL sslmode=verify-full secret rotation." -ForegroundColor Yellow
            Write-Host "CA-aware web/worker task revisions are already live (steps C/D) and can already trust the new connection string." -ForegroundColor Yellow
            $confirmation = Read-Host "Type 'yes' to apply this plan against AWS account $($identity.Account) in ap-south-1"
            if ($confirmation -ne "yes") {
                Write-Fail "Not confirmed — aborting before apply. No secret rotation occurred."
                Write-Fail "CA-aware web/worker revisions remain deployed (step C/D) but the OLD secret is still AWSCURRENT — this is a safe stopping point."
                exit 1
            }
        } else {
            Write-Warn "-AutoApprove supplied — skipping interactive confirmation."
        }

        Write-Step "STEP G: Applying infrastructure (secret rotation)"
        Invoke-Checked -FilePath "terraform" -ArgumentList @("apply", "-input=false", "tfplan") `
            -FailureMessage "terraform apply failed"
    } finally {
        Pop-Location
    }
}

$newSecretVersionId = Get-SecretCurrentVersionId -SecretId $secretArn
if ($RequireTerraformNoChanges) {
    Write-Success "STEP G: No infrastructure changes (CI safety mode) — secret version unchanged: $newSecretVersionId"
} else {
    Write-Success "STEP G: Secret rotated. Previous version: $previousSecretVersionId -> New version: $newSecretVersionId"
}

# ── H. Run the migration using the EXACT registered ARN from step F ───────
if (-not $SkipMigration) {
    Write-Step "STEP H: Running migration on the CA-aware migrate task revision"
    & (Join-Path $PSScriptRoot "run-migrations.ps1") -TaskDefinitionArn $newMigrateArn
    $migrationExitCode = $LASTEXITCODE
    if ($migrationExitCode -ne 0) {
        Write-Fail "STEP H: Migration FAILED (exit $migrationExitCode) AFTER the secret was already rotated."
        Write-Fail "Stopping — NOT rolling back the secret or the database, NOT retrying automatically, NOT redeploying web/worker."
        Write-Host ""
        Write-Host "==============================" -ForegroundColor Red
        Write-Host "COORDINATED ROLLBACK REQUIRED — see runbook. Record for the operator:" -ForegroundColor Red
        Write-Host "  Secrets Manager secret ARN:      $secretArn"
        Write-Host "  Previous secret version id:      $previousSecretVersionId"
        Write-Host "  New (now AWSCURRENT) version id: $newSecretVersionId"
        Write-Host "  Web task definition:     previous=$previousWebArn"
        Write-Host "                            new=$newWebArn (already deployed, step C)"
        Write-Host "  Worker task definition:  previous=$previousWorkerArn"
        Write-Host "                            new=$newWorkerArn (already deployed, step C)"
        Write-Host "  Migrate task definition: previous=$previousMigrateArn"
        Write-Host "                            new=$newMigrateArn (registered step F — THIS RUN FAILED)"
        Write-Host "  Image: ${ecrUrl}:${ImageTag} (digest $($scanResult.Digest))"
        Write-Host ""
        Write-Host "Rollback (if the operator decides it's needed) must coordinate BOTH of:" -ForegroundColor Yellow
        Write-Host "  1. Restoring Secrets Manager version '$previousSecretVersionId' as AWSCURRENT" -ForegroundColor Yellow
        Write-Host "  2. Restoring web/worker to previous task-definition revisions ($previousWebArn / $previousWorkerArn)" -ForegroundColor Yellow
        Write-Host "  Restoring only one of the two reintroduces the exact TLS-trust mismatch this rollout exists to fix." -ForegroundColor Yellow
        Write-Host "  Never restore automatically — this script does not do it for you." -ForegroundColor Yellow
        Write-Host "==============================" -ForegroundColor Red
        exit 1
    }
    Write-Success "STEP H: Migration completed successfully on $newMigrateArn"
} else {
    Write-Warn "STEP H: -SkipMigration set — not running migration."
}

# ── I. Force new deployments of the already-registered web/worker
#      revisions so they reload the new AWSCURRENT secret ────────────────
Write-Step "STEP I: Forcing web service to reload the new secret version"
$webReloadArgs = @(
    "ecs", "update-service", "--cluster", $cluster, "--service", $webSvc,
    "--task-definition", $newWebArn, "--force-new-deployment"
) + $profileArgs + @("--region", $env:AWS_REGION, "--output", "json")
Invoke-Checked -FilePath "aws" -ArgumentList $webReloadArgs -FailureMessage "Forcing web service deployment failed"

Write-Step "STEP I: Forcing worker service to reload the new secret version"
$workerReloadArgs = @(
    "ecs", "update-service", "--cluster", $cluster, "--service", $workerSvc,
    "--task-definition", $newWorkerArn, "--force-new-deployment"
) + $profileArgs + @("--region", $env:AWS_REGION, "--output", "json")
Invoke-Checked -FilePath "aws" -ArgumentList $workerReloadArgs -FailureMessage "Forcing worker service deployment failed"

# ── J. Wait for both services to stabilize ─────────────────────────────────
Write-Step "STEP J: Waiting for web service to stabilize"
aws ecs wait services-stable --cluster $cluster --services $webSvc @profileArgs --region $env:AWS_REGION
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Web service did not stabilize after the secret-reload deployment. Check: aws ecs describe-services --cluster $cluster --services $webSvc"
    exit 1
}
Write-Success "Web service stable"

Write-Step "STEP J: Waiting for worker service to stabilize"
aws ecs wait services-stable --cluster $cluster --services $workerSvc @profileArgs --region $env:AWS_REGION
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Worker service did not stabilize after the secret-reload deployment. Check: aws ecs describe-services --cluster $cluster --services $workerSvc"
    exit 1
}
Write-Success "Worker service stable"

# ── K/L. Readiness gate — checked LAST, after everything else already
#         succeeded. Does not roll anything back automatically. ──────────
Write-Step "STEP K: Polling readiness ($appUrl/api/health?check=readiness)"
$ready = Test-AppReadiness -AppUrl $appUrl -TimeoutSeconds 180 -IntervalSeconds 10
if (-not $ready) {
    Write-Host ""
    Write-Host "==============================" -ForegroundColor Red
    Write-Host "STEP L: Deployment did NOT reach a ready state." -ForegroundColor Red
    Write-Host "Web/worker ARE running the new image/secret (they passed liveness and stabilized) — this does not roll anything back automatically." -ForegroundColor Red
    Write-Host "  Investigate: $appUrl/api/health?check=readiness" -ForegroundColor Yellow
    Write-Host "==============================" -ForegroundColor Red
    exit 1
}

# ── Summary / rollback-info report ─────────────────────────────────────────
Write-Host ""
Write-Host "==============================" -ForegroundColor Magenta
Write-Host "Deployment complete" -ForegroundColor Magenta
Write-Host "  App URL:        $appUrl"
Write-Host "  Image:          ${ecrUrl}:${ImageTag}"
Write-Host "  Image digest:   $($scanResult.Digest)"
Write-Host ""
Write-Host "  Web task definition:     previous=$previousWebArn"
Write-Host "                           new=$newWebArn"
Write-Host "  Worker task definition:  previous=$previousWorkerArn"
Write-Host "                           new=$newWorkerArn"
Write-Host "  Migrate task definition: previous=$previousMigrateArn"
Write-Host "                           new=$(if ($newMigrateArn) { $newMigrateArn } else { '(skipped -- -SkipMigration)' })"
Write-Host "  Secrets Manager version: previous=$previousSecretVersionId"
Write-Host "                           new=$newSecretVersionId"
Write-Host ""
$logsProfileHint = if ($env:AWS_PROFILE) { "--profile $env:AWS_PROFILE " } else { "" }
Write-Host "  Status check:   ./infra/scripts/show-deployment-status.ps1"
Write-Host "  Logs:           aws logs tail /ecs/schoolsync-staging/web --follow $logsProfileHint--region $env:AWS_REGION"
Write-Host ""
Write-Host "  COORDINATED ROLLBACK (manual, not automatic — see runbook above):" -ForegroundColor Yellow
Write-Host "    Rolling back after this point requires BOTH:" -ForegroundColor Yellow
Write-Host "      1. Restoring Secrets Manager version '$previousSecretVersionId' as AWSCURRENT" -ForegroundColor Yellow
Write-Host "      2. Restoring web/worker/migrate to their previous task-definition revisions (above)" -ForegroundColor Yellow
Write-Host "    Restoring only one of the two reintroduces the exact TLS-trust mismatch this rollout fixes." -ForegroundColor Yellow
Write-Host "==============================" -ForegroundColor Magenta
