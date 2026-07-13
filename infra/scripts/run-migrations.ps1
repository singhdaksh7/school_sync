<#
.SYNOPSIS
  Runs the SchoolSync Prisma migration ECS task (`npx prisma migrate deploy`)
  once, waits for it to finish, and exits non-zero if it failed. Reads all
  cluster/network/task-definition info from `terraform output` — run
  `terraform apply` first.

.PARAMETER TimeoutSeconds
  Max time to wait for the task to reach STOPPED before giving up.
#>
param(
    [int]$TimeoutSeconds = 600
)

. (Join-Path $PSScriptRoot "common.ps1")

Write-Step "Reading Terraform outputs"
$cluster        = Get-TerraformOutputRaw "ecs_cluster_name"
$taskDefinition = Get-TerraformOutputRaw "ecs_migrate_task_definition_arn"
$subnets        = (Get-TerraformOutputJson "public_subnet_ids") -join ","
$securityGroup  = Get-TerraformOutputRaw "ecs_tasks_security_group_id"
Write-Success "cluster=$cluster"
Write-Success "taskDefinition=$taskDefinition"

Write-Step "Starting migration task (npx prisma migrate deploy)"
$networkConfig = "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$securityGroup],assignPublicIp=ENABLED}"

$runResult = aws ecs run-task `
    --cluster $cluster `
    --task-definition $taskDefinition `
    --launch-type FARGATE `
    --network-configuration $networkConfig `
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
    $desc = aws ecs describe-tasks --cluster $cluster --tasks $taskArn --output json | ConvertFrom-Json
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
    Write-Fail "Inspect logs: aws logs tail /ecs/schoolsync-staging/migrate --since 30m"
    exit 1
}

Write-Success "Migration completed successfully (exitCode=0)."
exit 0
