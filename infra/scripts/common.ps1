<#
.SYNOPSIS
  Shared helpers for the infra/scripts/*.ps1 deployment scripts. Dot-sourced,
  not run directly.
#>

$ErrorActionPreference = "Stop"

$script:RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$script:TerraformDir = Join-Path $RepoRoot "infra\terraform"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "    OK: $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    WARN: $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "    FAIL: $Message" -ForegroundColor Red
}

function Assert-CommandExists {
    param([Parameter(Mandatory)][string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Fail "'$Name' is not installed or not on PATH."
        exit 1
    }
}

function Assert-AwsAuthenticated {
    Assert-CommandExists "aws"
    try {
        $identity = aws sts get-caller-identity --output json | ConvertFrom-Json
    } catch {
        Write-Fail "AWS CLI authentication check failed: $_"
        exit 1
    }
    if (-not $identity -or -not $identity.Account) {
        Write-Fail "AWS CLI is not authenticated. Run 'aws configure' or set credentials, then retry."
        exit 1
    }
    Write-Success "AWS CLI authenticated as $($identity.Arn) (account $($identity.Account))"
    return $identity
}

function Assert-TerraformAvailable {
    Assert-CommandExists "terraform"
    $version = terraform version -json | ConvertFrom-Json
    Write-Success "Terraform $($version.terraform_version) available"
}

function Invoke-Checked {
    <#
      Runs an external command, streaming output, and exits the script with
      the same non-zero code on failure — deployment failures must never be
      silently swallowed (task requirement).
    #>
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList,
        [string]$FailureMessage = "Command failed"
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "$FailureMessage (exit code $LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
        exit $LASTEXITCODE
    }
}

function Get-TerraformOutputRaw {
    param([Parameter(Mandatory)][string]$Name)
    Push-Location $TerraformDir
    try {
        $value = terraform output -raw $Name 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "terraform output -raw $Name failed — has 'terraform apply' been run yet?"
            exit 1
        }
        return $value
    } finally {
        Pop-Location
    }
}

function Get-TerraformOutputJson {
    param([Parameter(Mandatory)][string]$Name)
    Push-Location $TerraformDir
    try {
        $raw = terraform output -json $Name 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "terraform output -json $Name failed — has 'terraform apply' been run yet?"
            exit 1
        }
        return $raw | ConvertFrom-Json
    } finally {
        Pop-Location
    }
}

function Update-EcsServiceImage {
    <#
      Registers a new revision of an ECS task definition family with a
      patched container image (same tag family, new image URI/tag), then
      updates the given service to use it and forces a fresh deployment.
      Shared by update-web-service.ps1 and update-worker-service.ps1 — both
      do the exact same describe/patch/register/update/wait sequence, only
      the cluster/service/family/container name differ.
    #>
    param(
        [Parameter(Mandatory)][string]$Cluster,
        [Parameter(Mandatory)][string]$Service,
        [Parameter(Mandatory)][string]$Family,
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][string]$ImageUri
    )

    Write-Step "Fetching current task definition ($Family)"
    $current = aws ecs describe-task-definition --task-definition $Family --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Could not describe task definition '$Family'. Has 'terraform apply' created it yet?"
        exit 1
    }
    $taskDef = $current.taskDefinition

    $container = $taskDef.containerDefinitions | Where-Object { $_.name -eq $ContainerName }
    if (-not $container) {
        Write-Fail "Container '$ContainerName' not found in task definition '$Family'."
        exit 1
    }
    $previousImage = $container.image
    $container.image = $ImageUri
    Write-Success "Image: $previousImage -> $ImageUri"

    # register-task-definition only accepts a specific field subset — strip
    # everything describe-task-definition adds that isn't a valid input field.
    $registerPayload = [ordered]@{
        family                  = $taskDef.family
        containerDefinitions    = $taskDef.containerDefinitions
        requiresCompatibilities = $taskDef.requiresCompatibilities
        networkMode             = $taskDef.networkMode
        cpu                     = $taskDef.cpu
        memory                  = $taskDef.memory
        executionRoleArn        = $taskDef.executionRoleArn
        taskRoleArn             = $taskDef.taskRoleArn
    }

    $tmpFile = New-TemporaryFile
    try {
        ($registerPayload | ConvertTo-Json -Depth 30) | Set-Content -Path $tmpFile -Encoding utf8

        Write-Step "Registering new task definition revision"
        $registered = aws ecs register-task-definition --cli-input-json "file://$tmpFile" --output json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "aws ecs register-task-definition failed (exit $LASTEXITCODE)"
            exit 1
        }
        $newArn = $registered.taskDefinition.taskDefinitionArn
        Write-Success "Registered: $newArn"
    } finally {
        Remove-Item $tmpFile -ErrorAction SilentlyContinue
    }

    Write-Step "Updating service '$Service' to the new revision (force new deployment)"
    Invoke-Checked -FilePath "aws" -ArgumentList @(
        "ecs", "update-service",
        "--cluster", $Cluster,
        "--service", $Service,
        "--task-definition", $newArn,
        "--force-new-deployment",
        "--output", "json"
    ) -FailureMessage "aws ecs update-service failed"

    Write-Step "Waiting for service to stabilize (AWS CLI default waiter: ~10 min max)"
    aws ecs wait services-stable --cluster $Cluster --services $Service
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Service '$Service' did not stabilize. Check: aws ecs describe-services --cluster $Cluster --services $Service"
        exit 1
    }
    Write-Success "$Service is stable on $newArn"
    return $newArn
}

function Test-AppReadiness {
    <#
      Polls GET {AppUrl}/api/health?check=readiness until the app reports
      "ready" or the timeout elapses. This is deliberately SEPARATE from the
      ALB/container health check (which stays on plain /api/health — a
      liveness-only probe, so transient Redis/S3/worker degradation never
      causes ECS to kill an otherwise-running task; see
      infra/terraform/variables.tf health_check_path). This function is the
      POST-DEPLOY GATE: it decides whether the script reports the deployment
      itself as successful, without affecting whether ECS considers the
      tasks healthy.

      Only ever prints the readiness response's own fields (status + a
      "checks" object of booleans/enums — see src/app/api/health/route.ts,
      which documents that endpoint as never exposing secrets, connection
      strings, or credentials). Never prints anything else about the
      environment.

      Returns $true/$false. Never exits the process — the caller decides
      what a failed readiness check means for its own exit code.
    #>
    param(
        [Parameter(Mandatory)][string]$AppUrl,
        [int]$TimeoutSeconds = 180,
        [int]$IntervalSeconds = 10
    )

    Write-Step "Waiting for readiness: GET $AppUrl/api/health?check=readiness (timeout ${TimeoutSeconds}s)"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $attempt = 0

    while ((Get-Date) -lt $deadline) {
        $attempt++
        # /api/health?check=readiness returns HTTP 503 for status="not_ready"
        # (database down) and HTTP 200 for "ready"/"degraded" — Invoke-WebRequest
        # throws on the 503, so the body is read from the exception in that
        # case rather than from a successful response.
        $statusCode = $null
        $body = $null
        try {
            $resp = Invoke-WebRequest -Uri "$AppUrl/api/health?check=readiness" -UseBasicParsing -TimeoutSec 15
            $statusCode = [int]$resp.StatusCode
            $body = $resp.Content | ConvertFrom-Json
        } catch {
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
                try { $body = $_.ErrorDetails.Message | ConvertFrom-Json } catch { $body = $null }
            }
            if (-not $statusCode) {
                Write-Warn "attempt $attempt : readiness request failed (service may still be warming up): $($_.Exception.Message)"
            }
        }

        if ($body) {
            Write-Host "    attempt $attempt : HTTP $statusCode, status=$($body.status)"
            if ($body.checks) {
                foreach ($prop in $body.checks.PSObject.Properties) {
                    Write-Host "        $($prop.Name)=$($prop.Value)"
                }
            }

            if ($statusCode -eq 200 -and $body.status -eq "ready") {
                Write-Success "App reports ready (attempt $attempt)"
                return $true
            }
            if ($body.status -eq "not_ready") {
                Write-Warn "Database unreachable — will keep retrying until timeout"
            } elseif ($body.status -eq "degraded") {
                Write-Warn "App is degraded (missing a required production dependency) — will keep retrying until timeout"
            }
        }

        Start-Sleep -Seconds $IntervalSeconds
    }

    Write-Fail "App did not report ready within ${TimeoutSeconds}s"
    return $false
}

function Assert-BackendConfigExists {
    $backendConfig = Join-Path $TerraformDir "backend.hcl"
    if (-not (Test-Path $backendConfig)) {
        Write-Fail "infra/terraform/backend.hcl not found."
        Write-Host "    Copy infra/terraform/backend.hcl.example to backend.hcl and fill in your state bucket/table, then retry." -ForegroundColor Yellow
        exit 1
    }
    return $backendConfig
}

function Read-HclKeyValueFile {
    <#
      Minimal, read-only parser for the flat "key = value" lines used by
      terraform.tfvars and backend.hcl in this repo (no nested blocks, no
      lists/maps needed by any preflight check). Strips quotes, skips
      comments/blank lines. Not a general HCL parser — deliberately just
      enough to read the handful of scalar values preflight.ps1 needs before
      `terraform init`/`apply` has ever run (so there's no state or
      `terraform output` to read from yet).
    #>
    param([Parameter(Mandatory)][string]$Path)
    $result = @{}
    if (-not (Test-Path $Path)) { return $result }
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        if ($trimmed -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
            $result[$Matches[1]] = $Matches[2]
        }
    }
    return $result
}
