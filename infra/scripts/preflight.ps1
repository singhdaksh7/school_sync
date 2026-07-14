<#
.SYNOPSIS
  Read-only prerequisite check for everything `terraform apply` and the ECS
  rollout scripts assume already exists but never create or verify
  themselves: AWS auth, the target account/region, the pre-existing ECR
  repository, the Terraform state S3 bucket + DynamoDB lock table, an
  optional image tag already pushed to ECR, and (when HTTPS or SES is
  configured) the domain/Route53 information they depend on.

  Every AWS CLI call in this script is a read-only describe/list/get — it
  NEVER creates, modifies, or deletes any AWS resource, and it never prints
  a credential or secret value (only account IDs, ARNs, resource names/IDs,
  and booleans — the same "safe to print" contract as /api/health).

.PARAMETER ExpectedAccountId
  Optional. If supplied, the script fails if the authenticated AWS CLI
  identity's account does not match.

.PARAMETER ImageTag
  Optional. If supplied, checks that this tag already exists in the ECR
  repository — run this right before an ECS rollout (update-web-service.ps1
  / update-worker-service.ps1 / deploy-staging.ps1) to catch a typo'd or
  never-pushed tag before it becomes a failed/stuck deployment.

.EXAMPLE
  ./infra/scripts/preflight.ps1
.EXAMPLE
  ./infra/scripts/preflight.ps1 -ExpectedAccountId 123456789012 -ImageTag 2026-07-07-abc1234
#>
param(
    [string]$ExpectedAccountId = "",
    [string]$ImageTag = "",
    [switch]$UseOidcCredentials
)

if ($UseOidcCredentials) { $env:SCHOOLSYNC_CI_OIDC = "1" }

. (Join-Path $PSScriptRoot "common.ps1")

Write-Host "SchoolSync AWS deployment preflight (read-only — creates/modifies nothing)" -ForegroundColor Magenta
Write-Host "===========================================================================" -ForegroundColor Magenta

$results = New-Object System.Collections.Generic.List[object]
function Record-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail, [bool]$Applicable = $true)
    $results.Add([pscustomobject]@{ Name = $Name; Ok = $Ok; Detail = $Detail; Applicable = $Applicable })
    if (-not $Applicable) {
        Write-Host "    SKIP: $Name — $Detail" -ForegroundColor DarkGray
    } elseif ($Ok) {
        Write-Success "$Name — $Detail"
    } else {
        Write-Fail "$Name — $Detail"
    }
}

# ── 1. AWS CLI authentication (non-root, verified via the same checkpoint
#      every other deployment script uses) ───────────────────────────────
Write-Step "AWS CLI authentication"
$identity = Assert-AwsAuthenticated
$profileArgs = Get-AwsCliProfileArgs
Record-Check "AWS caller identity" $true "account=$($identity.Account) arn=$($identity.Arn)"

# ── 2. Expected account / region ─────────────────────────────────────────
Write-Step "Expected account / region"
$tfvarsPath = Join-Path $TerraformDir "terraform.tfvars"
$tfvars = Read-HclKeyValueFile -Path $tfvarsPath
if (-not (Test-Path $tfvarsPath)) {
    Write-Warn "infra/terraform/terraform.tfvars not found (copy from terraform.tfvars.example) — skipping region cross-check."
}
$configuredRegion = $tfvars["aws_region"]
# `aws configure get region` reads a named PROFILE's config — meaningless in
# OIDC/CI mode, where there is no profile at all and the region instead
# comes directly from $env:AWS_REGION (already set by Assert-AwsAuthenticated
# / the OIDC action). Use that directly when no profile is in use.
$currentRegion = if ($env:AWS_PROFILE) { aws configure get region @profileArgs 2>$null } else { $env:AWS_REGION }
if ($configuredRegion) {
    Record-Check "Region matches terraform.tfvars" ($currentRegion -eq $configuredRegion) "AWS CLI region='$currentRegion', terraform.tfvars aws_region='$configuredRegion'"
}
if ($ExpectedAccountId) {
    Record-Check "Account matches -ExpectedAccountId" ($identity.Account -eq $ExpectedAccountId) "authenticated=$($identity.Account), expected=$ExpectedAccountId"
} else {
    Record-Check "Account matches -ExpectedAccountId" $true "not supplied — skipped" -Applicable $false
}

# ── 3. ECR repository exists (Terraform only looks it up, never creates it) ─
Write-Step "ECR repository"
$ecrName = $tfvars["ecr_repository_name"]
if ($ecrName) {
    $ecrDescribe = aws ecr describe-repositories --repository-names $ecrName @profileArgs --region $env:AWS_REGION --output json 2>$null
    if ($LASTEXITCODE -eq 0) {
        Record-Check "ECR repository '$ecrName' exists" $true "confirmed via aws ecr describe-repositories"
    } else {
        Record-Check "ECR repository '$ecrName' exists" $false "not found in account $($identity.Account) / region $currentRegion — infra/terraform/ecr.tf will fail at plan/apply time"
    }
} else {
    Record-Check "ECR repository exists" $true "ecr_repository_name not set in terraform.tfvars — skipped" -Applicable $false
}

# ── 4. Terraform state S3 bucket + DynamoDB lock table ──────────────────
Write-Step "Terraform remote state backend"
$backendPath = Join-Path $TerraformDir "backend.hcl"
$backend = Read-HclKeyValueFile -Path $backendPath
if (-not (Test-Path $backendPath)) {
    Record-Check "backend.hcl exists" $false "infra/terraform/backend.hcl not found — copy from backend.hcl.example and fill in your state bucket/table"
} else {
    $stateBucket = $backend["bucket"]
    $lockTable = $backend["dynamodb_table"]
    if ($stateBucket) {
        aws s3api head-bucket --bucket $stateBucket @profileArgs --region $env:AWS_REGION 2>$null
        Record-Check "State bucket '$stateBucket' exists" ($LASTEXITCODE -eq 0) "aws s3api head-bucket"
    }
    if ($lockTable) {
        aws dynamodb describe-table --table-name $lockTable @profileArgs --region $env:AWS_REGION --output json 2>$null | Out-Null
        Record-Check "Lock table '$lockTable' exists" ($LASTEXITCODE -eq 0) "aws dynamodb describe-table"
    }
}

# ── 5. Image tag already pushed to ECR (only relevant right before a rollout) ─
Write-Step "Docker image tag in ECR"
if ($ImageTag -and $ecrName) {
    aws ecr describe-images --repository-name $ecrName --image-ids imageTag=$ImageTag @profileArgs --region $env:AWS_REGION --output json 2>$null | Out-Null
    Record-Check "Image tag '$ImageTag' exists in ECR" ($LASTEXITCODE -eq 0) "aws ecr describe-images"
} else {
    Record-Check "Image tag exists in ECR" $true "-ImageTag not supplied — skipped (pass -ImageTag right before an ECS rollout to check this)" -Applicable $false
}

# ── 6. Domain / Route53 present when HTTPS or SES is configured ─────────
Write-Step "Domain / Route53 (only checked when HTTPS or SES is configured)"
$domainName = $tfvars["domain_name"]
$zoneId = $tfvars["route53_zone_id"]
$certArn = $tfvars["alb_certificate_arn"]
$sesDomain = $tfvars["ses_domain"]

$wantsHttps = [bool]$domainName
if ($wantsHttps) {
    $hasCertPath = [bool]$zoneId -or [bool]$certArn
    Record-Check "HTTPS: route53_zone_id or alb_certificate_arn set" $hasCertPath "domain_name='$domainName' requires one of the two so a certificate can be validated"
    if ($zoneId) {
        aws route53 get-hosted-zone --id $zoneId @profileArgs --region $env:AWS_REGION --output json 2>$null | Out-Null
        Record-Check "Route53 zone '$zoneId' exists and is reachable" ($LASTEXITCODE -eq 0) "aws route53 get-hosted-zone"
    }
} else {
    Record-Check "HTTPS domain configuration" $true "domain_name not set — stack will deploy HTTP-only, skipped" -Applicable $false
}

if ($sesDomain) {
    Record-Check "SES: route53_zone_id set for DNS verification records" ([bool]$zoneId) "ses_domain='$sesDomain' without route53_zone_id means you must add the SES verification/DKIM DNS records manually (see terraform output after apply)"
} else {
    Record-Check "SES domain configuration" $true "ses_domain not set — SES not provisioned, skipped" -Applicable $false
}

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "===========================================================================" -ForegroundColor Magenta
$applicable = $results | Where-Object { $_.Applicable }
$failed = $applicable | Where-Object { -not $_.Ok }
if ($failed.Count -eq 0) {
    Write-Host "Preflight PASSED ($($applicable.Count) checks, $($results.Count - $applicable.Count) skipped as not applicable)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Preflight FAILED — $($failed.Count) of $($applicable.Count) applicable checks failed:" -ForegroundColor Red
    foreach ($f in $failed) {
        Write-Host "  - $($f.Name): $($f.Detail)" -ForegroundColor Red
    }
    exit 1
}
