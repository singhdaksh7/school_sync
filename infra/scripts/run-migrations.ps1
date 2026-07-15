<#
.SYNOPSIS
  Runs the SchoolSync Prisma migration ECS task (`npx prisma migrate deploy`)
  once, waits for it to finish, and exits non-zero if it failed. Cluster and
  network info come from `terraform output`, but the task-definition ARN
  MUST be supplied explicitly by the caller (-TaskDefinitionArn) — this
  script never resolves it from `terraform output
  ecs_migrate_task_definition_arn` itself.

  Why: infra/terraform/ecs.tf's migrate task definition carries `lifecycle
  { ignore_changes = [container_definitions] }`, so that Terraform output
  permanently points at whatever revision was first ever registered — it
  never reflects a newer image or a CA-trust/environment fix landed after
  that. Silently resolving it here would let migrations run against a
  stale image without the caller ever noticing. Register a current revision
  first with update-migrate-task.ps1 (or point at a specific known-good
  revision deliberately), then pass that exact ARN in.

.PARAMETER TaskDefinitionArn
  REQUIRED. The exact task-definition ARN (family:revision) to run. Get
  this from `./infra/scripts/update-migrate-task.ps1 -ImageTag <tag>`
  (its final stdout line), or from `aws ecs describe-task-definition` /
  `aws ecs list-task-definitions` if intentionally re-running a specific
  known revision.

.PARAMETER TimeoutSeconds
  Max time to wait for the task to reach STOPPED before giving up.

.EXAMPLE
  $migrateArn = ./infra/scripts/update-migrate-task.ps1 -ImageTag $tag | Select-Object -Last 1
  ./infra/scripts/run-migrations.ps1 -TaskDefinitionArn $migrateArn
#>
param(
    [Parameter(Mandatory)][string]$TaskDefinitionArn,
    [int]$TimeoutSeconds = 600,
    [switch]$UseOidcCredentials
)

if ($UseOidcCredentials) { $env:SCHOOLSYNC_CI_OIDC = "1" }

. (Join-Path $PSScriptRoot "common.ps1")

Assert-AwsAuthenticated | Out-Null

Write-Step "Reading Terraform outputs"
$cluster        = Get-TerraformOutputRaw "ecs_cluster_name"
$subnets        = (Get-TerraformOutputJson "ecs_task_subnet_ids") -join ","
$assignPublicIp = if ((Get-TerraformOutputRaw "ecs_assign_public_ip") -eq "true") { "ENABLED" } else { "DISABLED" }
$securityGroup  = Get-TerraformOutputRaw "ecs_tasks_security_group_id"
$taskDefinition = $TaskDefinitionArn
Write-Success "cluster=$cluster"
Write-Success "taskDefinition=$taskDefinition (caller-supplied, not resolved from Terraform)"

Write-Step "Starting migration task (npx prisma migrate deploy)"
$networkConfig = "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$securityGroup],assignPublicIp=$assignPublicIp}"
$profileArgs = Get-AwsCliProfileArgs

$runResult = aws ecs run-task `
    --cluster $cluster `
    --task-definition $taskDefinition `
    --launch-type FARGATE `
    --network-configuration $networkConfig `
    @profileArgs `
    --region $env:AWS_REGION `
    --output json | ConvertFrom-Json

if ($LASTEXITCODE -ne 0) {
    Write-Fail "aws ecs run-task failed (exit $LASTEXITCODE)"
    exit 1
}

if ($runResult.failures -and $runResult.failures.Count -gt 0) {
    Write-Fail "ECS refused to start the migration task:"
    $runResult.failures | ForEach-Object { Write-Fail "  $($_.reason): $($_.arn)" }
    exit 1
}

$taskArn = $runResult.tasks[0].taskArn
Write-Success "Task started: $taskArn"

Write-Step "Waiting for migration task to stop (timeout ${TimeoutSeconds}s)"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$lastStatus = ""
while ((Get-Date) -lt $deadline) {
    $desc = aws ecs describe-tasks --cluster $cluster --tasks $taskArn @profileArgs --region $env:AWS_REGION --output json | ConvertFrom-Json
    $lastStatus = $desc.tasks[0].lastStatus
    if ($lastStatus -eq "STOPPED") { break }
    Write-Host "    ... status=$lastStatus" -ForegroundColor DarkGray
    Start-Sleep -Seconds 10
}

if ($lastStatus -ne "STOPPED") {
    Write-Fail "Migration task did not reach STOPPED within ${TimeoutSeconds}s (last status: $lastStatus)."
    Write-Fail "Deployment halted — a failed/stuck migration must stop the deployment. Check CloudWatch Logs (/ecs/schoolsync-*/migrate) and the task manually."
    exit 1
}

$container = $desc.tasks[0].containers[0]
$exitCode = $container.exitCode
$stoppedReason = $desc.tasks[0].stoppedReason

Write-Step "Migration task result"
Write-Host "    stoppedReason: $stoppedReason"
Write-Host "    container exitCode: $exitCode"

if ($null -eq $exitCode -or $exitCode -ne 0) {
    Write-Fail "Migration FAILED (exitCode=$exitCode). Deployment halted — web/worker services were not touched."
    Write-Fail "Inspect the migrate CloudWatch log group reported by terraform output cloudwatch_log_groups."
    exit 1
}

Write-Success "Migration completed successfully (exitCode=0)."
exit 0
