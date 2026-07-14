<#
.SYNOPSIS
  Rolls the SchoolSync background-worker ECS service onto a new image tag —
  same pattern as update-web-service.ps1, targeting the worker task family
  and its "worker" container.

.PARAMETER ImageTag
  Tag on the existing ECR repository to deploy. Usually run right after
  update-web-service.ps1 with the same tag, so web and worker stay in sync.

.EXAMPLE
  ./infra/scripts/update-worker-service.ps1 -ImageTag "2026-07-07-abc1234"
#>
param(
    [Parameter(Mandatory)][string]$ImageTag,
    [switch]$UseOidcCredentials
)

if ($UseOidcCredentials) { $env:SCHOOLSYNC_CI_OIDC = "1" }

. (Join-Path $PSScriptRoot "common.ps1")

Assert-AwsAuthenticated | Out-Null

Write-Step "Reading Terraform outputs"
$cluster = Get-TerraformOutputRaw "ecs_cluster_name"
$service = Get-TerraformOutputRaw "ecs_worker_service_name"
$family  = Get-TerraformOutputRaw "ecs_worker_task_family"
$ecrUrl  = Get-TerraformOutputRaw "ecr_repository_url"
$image   = "${ecrUrl}:${ImageTag}"

Update-EcsServiceImage `
    -Cluster $cluster `
    -Service $service `
    -Family $family `
    -ContainerName "worker" `
    -ImageUri $image

Write-Step "Done"
Write-Success "Worker service '$service' is running $image"
