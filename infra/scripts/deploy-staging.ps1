<#
.SYNOPSIS
  End-to-end SchoolSync staging deployment: validates tooling, plans and
  applies the Terraform infrastructure, runs the Prisma migration task, then
  rolls out the ECS web and worker services and verifies ALB health.

  A failed migration stops the deployment before web/worker are touched — it
  is never silently skipped.

.PARAMETER ExpectedAccountId
  REQUIRED. The AWS account ID you intend to deploy into, sourced
  independently of whatever the AWS CLI happens to be authenticated as right
  now (e.g. from your runbook, a password manager note, or `aws sts
  get-caller-identity` run in a separate, already-trusted shell). This is
  compared against the CLI's actual authenticated identity immediately after
  authentication — before any Terraform or AWS mutating call — and the
  script aborts on a mismatch. This check is NOT satisfied by re-deriving
  the expected value from the same `aws sts get-caller-identity` call being
  checked (that would make the comparison tautological and catch nothing);
  it must come from a source outside this script run.

.PARAMETER AutoApprove
  Skip the interactive confirmation before `terraform apply`. Without this
  switch, the script always pauses for an explicit "yes" after showing the
  plan.

.PARAMETER SkipMigration
  Escape hatch for re-running this script when the last migration already
  succeeded and nothing changed. Off by default — migrations run every time.

.PARAMETER SkipPreflight
  Escape hatch to skip preflight.ps1's read-only AWS resource checks (ECR
  repo, state bucket/lock table, domain/Route53). Off by default. Does NOT
  affect the mandatory -ExpectedAccountId check above, which always runs.

.EXAMPLE
  ./infra/scripts/deploy-staging.ps1 -ExpectedAccountId 111122223333
.EXAMPLE
  ./infra/scripts/deploy-staging.ps1 -ExpectedAccountId 111122223333 -AutoApprove
#>
param(
    [Parameter(Mandatory)][string]$ExpectedAccountId,
    [switch]$AutoApprove,
    [switch]$SkipMigration,
    [switch]$SkipPreflight
)

. (Join-Path $PSScriptRoot "common.ps1")

Write-Host "SchoolSync staging deployment" -ForegroundColor Magenta
Write-Host "==============================" -ForegroundColor Magenta

# 1. Validate AWS CLI authentication
Write-Step "Validating AWS CLI authentication"
$identity = Assert-AwsAuthenticated

# 1.5. Confirm the CLI is authenticated into the account the operator
#      actually intended (-ExpectedAccountId, supplied independently of this
#      script run) — unconditional, never skippable via -SkipPreflight, so a
#      wrong-profile/wrong-account session can never reach terraform
#      apply/aws ecs update-service just because preflight was bypassed.
Write-Step "Confirming AWS account matches -ExpectedAccountId"
if ($identity.Account -ne $ExpectedAccountId) {
    Write-Fail "Authenticated AWS account ($($identity.Account)) does not match -ExpectedAccountId ($ExpectedAccountId)."
    Write-Fail "Refusing to deploy — this is very likely the wrong AWS profile/credentials. Aborting before any change."
    exit 1
}
Write-Success "Authenticated account matches -ExpectedAccountId ($($identity.Account))"

# 2. Validate Terraform availability
Write-Step "Validating Terraform availability"
Assert-TerraformAvailable

$backendConfig = Assert-BackendConfigExists

# 2.5. AWS prerequisite preflight (read-only — see preflight.ps1) — catches
#      a missing ECR repo / state bucket / lock table / domain config before
#      `terraform init`/`apply` gets anywhere near them, rather than failing
#      partway through a plan or apply. Passes the operator-supplied
#      -ExpectedAccountId through unchanged (not $identity.Account) so
#      preflight's own account-match check is a real, independent
#      confirmation rather than a comparison against itself.
if (-not $SkipPreflight) {
    Write-Step "Running AWS prerequisite preflight"
    & (Join-Path $PSScriptRoot "preflight.ps1") -ExpectedAccountId $ExpectedAccountId
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Preflight failed — see above. Re-run with -SkipPreflight to bypass (not recommended)."
        exit 1
    }
}

Push-Location $TerraformDir
try {
    # 3. terraform fmt
    Write-Step "Running terraform fmt"
    terraform fmt -recursive | Out-Null
    Write-Success "Formatted"

    # 4. terraform init
    Write-Step "Running terraform init"
    Invoke-Checked -FilePath "terraform" -ArgumentList @("init", "-backend-config=$backendConfig", "-input=false") `
        -FailureMessage "terraform init failed"

    # 5. terraform validate
    Write-Step "Running terraform validate"
    Invoke-Checked -FilePath "terraform" -ArgumentList @("validate") -FailureMessage "terraform validate failed"

    # 6. terraform plan
    Write-Step "Running terraform plan"
    $planArgs = @("plan", "-out=tfplan", "-input=false")
    if (Test-Path "terraform.tfvars") { $planArgs += "-var-file=terraform.tfvars" }
    Invoke-Checked -FilePath "terraform" -ArgumentList $planArgs -FailureMessage "terraform plan failed"

    # 7. Confirm before apply
    if (-not $AutoApprove) {
        Write-Host ""
        Write-Host "Review the plan above." -ForegroundColor Yellow
        $confirmation = Read-Host "Type 'yes' to apply this plan against AWS account $($identity.Account) in ap-south-1"
        if ($confirmation -ne "yes") {
            Write-Fail "Not confirmed — aborting before apply. No changes were made."
            exit 1
        }
    } else {
        Write-Warn "-AutoApprove supplied — skipping interactive confirmation."
    }

    # 8. terraform apply
    Write-Step "Applying infrastructure"
    Invoke-Checked -FilePath "terraform" -ArgumentList @("apply", "-input=false", "tfplan") `
        -FailureMessage "terraform apply failed"

    # 9. Retrieve outputs
    Write-Step "Retrieving Terraform outputs"
    $outputs = terraform output -json | ConvertFrom-Json
    Write-Success "alb_dns_name = $($outputs.alb_dns_name.value)"
    Write-Success "app_url      = $($outputs.app_url.value)"
} finally {
    Pop-Location
}

# 10-12. Run + verify the migration task (run-migrations.ps1 exits non-zero
# and prints why on any failure — that non-zero code stops this script here,
# before web/worker are touched, per the "failed migration halts deployment"
# requirement).
if ($SkipMigration) {
    Write-Warn "SkipMigration set — NOT running the Prisma migration task. Only use this when you're certain nothing changed."
} else {
    Write-Step "Running database migration"
    & (Join-Path $PSScriptRoot "run-migrations.ps1")
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Migration failed — deployment halted. Web/worker services were NOT redeployed."
        exit 1
    }
}

# 13-14. Force-deploy + wait for the web service to stabilize on the
# just-applied task definition (picks up any mutable-tag image update).
Push-Location $TerraformDir
try {
    $cluster = (terraform output -raw ecs_cluster_name)
    $webSvc = (terraform output -raw ecs_web_service_name)
    $workerSvc = (terraform output -raw ecs_worker_service_name)
} finally {
    Pop-Location
}

Write-Step "Forcing a fresh deployment of the web service"
Invoke-Checked -FilePath "aws" -ArgumentList @(
    "ecs", "update-service", "--cluster", $cluster, "--service", $webSvc,
    "--force-new-deployment", "--output", "json"
) -FailureMessage "Forcing web service deployment failed"

Write-Step "Waiting for web service to stabilize"
aws ecs wait services-stable --cluster $cluster --services $webSvc
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Web service did not stabilize. Check: aws ecs describe-services --cluster $cluster --services $webSvc"
    exit 1
}
Write-Success "Web service stable"

# 15. Deploy/verify worker service
Write-Step "Forcing a fresh deployment of the worker service"
Invoke-Checked -FilePath "aws" -ArgumentList @(
    "ecs", "update-service", "--cluster", $cluster, "--service", $workerSvc,
    "--force-new-deployment", "--output", "json"
) -FailureMessage "Forcing worker service deployment failed"

Write-Step "Waiting for worker service to stabilize"
aws ecs wait services-stable --cluster $cluster --services $workerSvc
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Worker service did not stabilize. Check: aws ecs describe-services --cluster $cluster --services $workerSvc"
    exit 1
}
Write-Success "Worker service stable"

# 16. Readiness gate — the ALB/container health check (already passed,
#     since the services above stabilized) only proves liveness. This step
#     decides whether the DEPLOYMENT ITSELF succeeded: it polls the
#     readiness endpoint (separate from liveness — see Test-AppReadiness in
#     common.ps1) and only exits 0 once the app reports every REQUIRED
#     production dependency configured and ready, or fails the whole script
#     if it never does within the timeout.
Push-Location $TerraformDir
try {
    $appUrl = (terraform output -raw app_url)
} finally {
    Pop-Location
}

$ready = Test-AppReadiness -AppUrl $appUrl -TimeoutSeconds 180 -IntervalSeconds 10
if (-not $ready) {
    Write-Fail "Deployment did not reach a ready state — see component states above. The web/worker services ARE running (they passed liveness), but a required production dependency is missing or the database is unreachable."
    Write-Host "    Investigate: $appUrl/api/health?check=readiness" -ForegroundColor Yellow
    exit 1
}

# 17. Summary
Write-Host ""
Write-Host "==============================" -ForegroundColor Magenta
Write-Host "Deployment complete" -ForegroundColor Magenta
Write-Host "  App URL:        $appUrl"
Write-Host "  Status check:   ./infra/scripts/show-deployment-status.ps1"
Write-Host "  Roll a new tag: ./infra/scripts/update-web-service.ps1 -ImageTag <tag>"
Write-Host "                  ./infra/scripts/update-worker-service.ps1 -ImageTag <tag>"
Write-Host "  Logs:           aws logs tail /ecs/schoolsync-staging/web --follow"
Write-Host ""
Write-Host "  Automatic rollback: ECS's deployment circuit breaker already reverts a"
Write-Host "  failed rollout to the previous task-definition revision on its own"
Write-Host "  (infra/terraform/ecs.tf, deployment_circuit_breaker). Manual rollback to"
Write-Host "  a specific known-good revision, if ever needed:"
Write-Host "    aws ecs list-task-definitions --family-prefix schoolsync-staging-web --sort DESC"
Write-Host "    aws ecs update-service --cluster <cluster> --service <service> \"
Write-Host "      --task-definition schoolsync-staging-web:<REVISION> --force-new-deployment"
Write-Host "  (swap 'web' for 'worker' for the worker service.)"
Write-Host "==============================" -ForegroundColor Magenta
