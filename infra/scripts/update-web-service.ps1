<#
.SYNOPSIS
  Rolls the SchoolSync web/API ECS service onto a new image tag without
  re-running terraform apply — registers a new task-definition revision
  (same family, patched image) and force-deploys it.

.PARAMETER ImageTag
  Tag on the existing ECR repository to deploy (e.g. a commit SHA or CI build
  tag). Must already have been pushed.

.EXAMPLE
  ./infra/scripts/update-web-service.ps1 -ImageTag "2026-07-07-abc1234"
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
$service = Get-TerraformOutputRaw "ecs_web_service_name"
$family  = Get-TerraformOutputRaw "ecs_web_task_family"
$ecrUrl  = Get-TerraformOutputRaw "ecr_repository_url"
$image   = "${ecrUrl}:${ImageTag}"

Update-EcsServiceImage `
    -Cluster $cluster `
    -Service $service `
    -Family $family `
    -ContainerName "web" `
    -ImageUri $image

Write-Step "Done"
Write-Success "Web service '$service' is running $image"
