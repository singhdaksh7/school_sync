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

.OUTPUTS
  Prints progress to the host, then writes the new task-definition ARN as
  the final line of stdout (nothing else on that line) so a caller can
  capture it directly, e.g.:
    $migrateArn = ./infra/scripts/update-migrate-task.ps1 -ImageTag $tag | Select-Object -Last 1

.EXAMPLE
  ./infra/scripts/update-migrate-task.ps1 -ImageTag "candidate-abc123..."
#>
param(
    [Parameter(Mandatory)][string]$ImageTag
)

. (Join-Path $PSScriptRoot "common.ps1")

Assert-AwsAuthenticated | Out-Null

Write-Step "Reading Terraform outputs"
$family = Get-TerraformOutputRaw "ecs_migrate_task_family"
$ecrUrl = Get-TerraformOutputRaw "ecr_repository_url"
$image  = "${ecrUrl}:${ImageTag}"

$newArn = Register-EcsTaskDefinitionWithImage `
    -Family $family `
    -ContainerName "migrate" `
    -ImageUri $image

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
