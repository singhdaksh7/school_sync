<#
.SYNOPSIS
  Registers a new revision of the SchoolSync migrate ECS task definition
  with a patched image. Does NOT run it and does NOT create or touch any
  ECS service — the migrate task definition backs a one-off `aws ecs
  run-task` only (see run-migrations.ps1), never a standing service.

  This closes a gap the web/worker rollout scripts didn't have: before this
  script existed, the migrate task definition had no update path at all —
  infra/terraform/ecs.tf's `aws_ecs_task_definition.migrate` carries
  `lifecycle { ignore_changes = [container_definitions] }`, so `terraform
  apply` can never advance it past whatever revision was first created, and
  no script registered new revisions for it the way
  update-web-service.ps1/update-worker-service.ps1 do for web/worker.

.PARAMETER ImageTag
  Tag on the existing ECR repository to deploy (e.g. a commit SHA or
  candidate build tag). Must already have been pushed and scanned.

.PARAMETER Family
  Optional. The migrate task-definition family name (e.g.
  "schoolsync-staging-migrate"). deploy-staging.ps1 always supplies this
  explicitly, derived from the already-applied `ecs_migrate_task_definition_arn`
  output rather than the newer `ecs_migrate_task_family` output, so the
  coordinated rollout's STEP F never depends on an output that STEP G's own
  `terraform apply` is what first creates.

  When omitted (standalone/ad-hoc use), this script resolves the family
  itself: it tries the `ecs_migrate_task_family` Terraform output first,
  and if that isn't present in state yet, falls back to parsing the
  family out of the existing `ecs_migrate_task_definition_arn` output. If
  neither is available, this script fails closed rather than guessing.

.OUTPUTS
  Prints progress to the host, then writes the new task-definition ARN as
  the final line of stdout (nothing else on that line) so a caller can
  capture it directly, e.g.:
    $migrateArn = ./infra/scripts/update-migrate-task.ps1 -ImageTag $tag | Select-Object -Last 1

.EXAMPLE
  ./infra/scripts/update-migrate-task.ps1 -ImageTag "candidate-abc123..."
.EXAMPLE
  ./infra/scripts/update-migrate-task.ps1 -ImageTag "candidate-abc123..." -Family "schoolsync-staging-migrate"
#>
param(
    [Parameter(Mandatory)][string]$ImageTag,
    [string]$Family,
    [switch]$UseOidcCredentials
)

if ($UseOidcCredentials) { $env:SCHOOLSYNC_CI_OIDC = "1" }

. (Join-Path $PSScriptRoot "common.ps1")

Assert-AwsAuthenticated | Out-Null

if ($Family) {
    Write-Step "Using explicitly supplied migrate task family"
    Write-Success "Family: $Family"
} else {
    Write-Step "Resolving migrate task family (no -Family supplied — standalone usage)"
    $Family = Get-TerraformOutputRawOptional "ecs_migrate_task_family"
    if ($Family) {
        Write-Success "Resolved from Terraform output 'ecs_migrate_task_family': $Family"
    } else {
        Write-Warn "'ecs_migrate_task_family' output not present (likely not yet applied) — falling back to the existing migrate task-definition ARN."
        $existingArn = Get-TerraformOutputRawOptional "ecs_migrate_task_definition_arn"
        if (-not $existingArn) {
            Write-Fail "Cannot determine the migrate task family: neither 'ecs_migrate_task_family' nor 'ecs_migrate_task_definition_arn' is available in Terraform state."
            Write-Fail "Has the migrate task definition ever been created by a prior 'terraform apply'? Refusing to guess a family name."
            exit 1
        }
        $Family = Get-EcsTaskFamilyFromArn -TaskDefinitionArn $existingArn
        Write-Success "Resolved '$Family' from existing ARN: $existingArn"
    }
}

Write-Step "Reading Terraform outputs"
$ecrUrl = Get-TerraformOutputRaw "ecr_repository_url"
$image  = "${ecrUrl}:${ImageTag}"

$newArn = Register-EcsTaskDefinitionWithImage `
    -Family $Family `
    -ContainerName "migrate" `
    -ImageUri $image
$newArn = Assert-SingleEcsTaskDefinitionArn -Value $newArn -ExpectedFamily $Family

Write-Step "Done"
Write-Success "Registered migrate task definition: $newArn"
Write-Host ""
Write-Host "This revision has NOT been run. To execute the migration:" -ForegroundColor Yellow
Write-Host "    ./infra/scripts/run-migrations.ps1 -TaskDefinitionArn `"$newArn`"" -ForegroundColor Yellow

# Machine-readable ARN as the last stdout line, for callers that capture
# output (e.g. `... | Select-Object -Last 1`) instead of parsing the
# human-readable Write-Success/Write-Host lines above.
$newArn
exit 0
