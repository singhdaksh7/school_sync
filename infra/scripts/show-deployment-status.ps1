<#
.SYNOPSIS
  Read-only snapshot of the current staging deployment: ECS service status,
  running task counts, ALB target health, and the app's health endpoint.
  Safe to run any time — makes no changes.
#>

. (Join-Path $PSScriptRoot "common.ps1")

Assert-AwsAuthenticated | Out-Null

Write-Step "Terraform outputs"
$cluster    = Get-TerraformOutputRaw "ecs_cluster_name"
$webSvc     = Get-TerraformOutputRaw "ecs_web_service_name"
$workerSvc  = Get-TerraformOutputRaw "ecs_worker_service_name"
$appUrl     = Get-TerraformOutputRaw "app_url"
$albDns     = Get-TerraformOutputRaw "alb_dns_name"
Write-Host "    cluster:    $cluster"
Write-Host "    app_url:    $appUrl"
Write-Host "    alb_dns:    $albDns"

Write-Step "ECS service status"
$services = aws ecs describe-services --cluster $cluster --services $webSvc $workerSvc --output json | ConvertFrom-Json
foreach ($svc in $services.services) {
    $deploymentStatus = ($svc.deployments | Where-Object { $_.status -eq "PRIMARY" }).rolloutState
    Write-Host ""
    Write-Host "  $($svc.serviceName)" -ForegroundColor White
    Write-Host "    status:        $($svc.status)"
    Write-Host "    desired/running/pending: $($svc.desiredCount) / $($svc.runningCount) / $($svc.pendingCount)"
    Write-Host "    rollout:       $deploymentStatus"
    Write-Host "    taskDefinition: $($svc.taskDefinition)"
    if ($svc.events -and $svc.events.Count -gt 0) {
        Write-Host "    last event:    $($svc.events[0].message)"
    }
}

Write-Step "ALB target group health"
try {
    $tgArn = (aws elbv2 describe-target-groups --names "*-web-tg" --output json 2>$null | ConvertFrom-Json).TargetGroups[0].TargetGroupArn
} catch {
    $tgArn = $null
}
if (-not $tgArn) {
    # Fallback: derive from the load balancer if the name-glob lookup above
    # isn't supported by the installed AWS CLI version.
    $lbArn = (aws elbv2 describe-load-balancers --output json | ConvertFrom-Json).LoadBalancers |
        Where-Object { $_.DNSName -eq $albDns } | Select-Object -First 1 -ExpandProperty LoadBalancerArn
    if ($lbArn) {
        $tgArn = (aws elbv2 describe-target-groups --load-balancer-arn $lbArn --output json | ConvertFrom-Json).TargetGroups[0].TargetGroupArn
    }
}
if ($tgArn) {
    $health = aws elbv2 describe-target-health --target-group-arn $tgArn --output json | ConvertFrom-Json
    foreach ($t in $health.TargetHealthDescriptions) {
        Write-Host "    target $($t.Target.Id):$($t.Target.Port) -> $($t.TargetHealth.State) $($t.TargetHealth.Reason)"
    }
} else {
    Write-Warn "Could not resolve the web target group — skipping target health."
}

Write-Step "App health endpoint ($appUrl/api/health)"
try {
    $resp = Invoke-WebRequest -Uri "$appUrl/api/health" -UseBasicParsing -TimeoutSec 10
    Write-Success "HTTP $($resp.StatusCode)"
    Write-Host "    $($resp.Content)"
} catch {
    Write-Warn "Health check request failed: $_"
}

Write-Step "Readiness endpoint ($appUrl/api/health?check=readiness)"
try {
    $resp = Invoke-WebRequest -Uri "$appUrl/api/health?check=readiness" -UseBasicParsing -TimeoutSec 10
    Write-Host "    HTTP $($resp.StatusCode): $($resp.Content)"
} catch {
    Write-Warn "Readiness check request failed: $_"
}

Write-Step "Manual rollback (if ever needed — ECS's deployment circuit breaker already auto-rolls-back a failed deployment on its own)"
Write-Host "    aws ecs list-task-definitions --family-prefix $($cluster)-web --sort DESC"
Write-Host "    aws ecs update-service --cluster $cluster --service $webSvc --task-definition <FAMILY:REVISION> --force-new-deployment"
Write-Host "    (swap web/$webSvc for worker/$workerSvc for the worker service)"
