<#
.SYNOPSIS
  Shared helpers for the infra/scripts/*.ps1 deployment scripts. Dot-sourced,
  not run directly.
#>

$ErrorActionPreference = "Stop"

$script:RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$script:TerraformDir = Join-Path $RepoRoot "infra\terraform"

# Every deployment script in this directory must run under the
# least-privilege SSO-assumed role, never the AWS account root user or an
# un-vetted default profile. This is the single source of truth for which
# profile/region every aws CLI call below uses — Assert-AwsAuthenticated is
# the one required checkpoint every script calls before any AWS action, and
# it both verifies AND exports $env:AWS_PROFILE/$env:AWS_REGION so a
# subsequent `terraform` invocation (which has no --profile flag of its own
# — it resolves credentials via the AWS provider's default chain, including
# AWS_PROFILE) inherits the same verified, non-root identity.
$script:DefaultAwsProfile = "schoolsync-admin"
$script:DefaultAwsRegion = "ap-south-1"

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
    <#
      The one required checkpoint every deployment script calls before any
      AWS action. Verifies authentication AND refuses to proceed if the
      resolved identity is the account root user — regardless of which
      profile produced it (root can be reached via a bare default profile,
      an `aws login` root session, or a misconfigured profile alias), so
      this check can never be bypassed by pointing -Profile at something
      else that still resolves to root. On success, exports
      $env:AWS_PROFILE/$env:AWS_REGION so every subsequent aws CLI call in
      this process (and any `terraform` invocation, which has no
      --profile flag of its own) uses the same verified identity.
    #>
    param([string]$Profile = $script:DefaultAwsProfile)

    Assert-CommandExists "aws"
    $identityArgs = @("sts", "get-caller-identity", "--output", "json")
    if ($Profile) { $identityArgs += @("--profile", $Profile) }

    try {
        $identity = aws @identityArgs | ConvertFrom-Json
    } catch {
        Write-Fail "AWS CLI authentication check failed (profile: $Profile): $_"
        exit 1
    }
    if ($LASTEXITCODE -ne 0 -or -not $identity -or -not $identity.Account) {
        Write-Fail "AWS CLI is not authenticated for profile '$Profile'. Run 'aws sso login --profile $Profile', then retry."
        exit 1
    }
    if ($identity.Arn -match '^arn:aws:iam::\d+:root$') {
        Write-Fail "Authenticated identity is the AWS account ROOT user ($($identity.Arn))."
        Write-Fail "Deployment scripts must never run as root. Run 'aws sso login --profile $Profile' and retry with an assumed-role (SSO) identity."
        exit 1
    }

    $env:AWS_PROFILE = $Profile
    $env:AWS_REGION = $script:DefaultAwsRegion

    Write-Success "AWS CLI authenticated as $($identity.Arn) (account $($identity.Account), profile $Profile)"
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

function Get-TerraformOutputRawOptional {
    <#
      Same as Get-TerraformOutputRaw, but returns $null instead of exiting
      the process when the named output isn't present in state yet — e.g.
      it was just added to outputs.tf by the same commit as a not-yet-run
      `terraform apply`. Adding an output block to a .tf file does not
      retroactively populate it into the state file; that only happens on
      the next apply, even if the resource attribute it reads already
      exists in state. Callers that have a safe fallback for that case use
      this instead of the hard-exit Get-TerraformOutputRaw.
    #>
    param([Parameter(Mandatory)][string]$Name)
    Push-Location $TerraformDir
    try {
        $value = terraform output -raw $Name 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return $value
    } finally {
        Pop-Location
    }
}

function Get-EcsTaskFamilyFromArn {
    <#
      Parses the task-definition family (no revision) out of a full
      task-definition ARN, e.g.
      "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-migrate:7"
      -> "schoolsync-staging-migrate". Every part is read from the ARN
      itself, never hardcoded. Fails closed (throws) rather than returning
      a guessed/partial family if the ARN doesn't match the expected shape
      — callers must never silently fall back to a wrong family name.
    #>
    param([Parameter(Mandatory)][string]$TaskDefinitionArn)

    if ($TaskDefinitionArn -notmatch '^arn:aws:ecs:[^:]+:\d+:task-definition/([^:/]+):\d+$') {
        throw "Cannot safely determine the task-definition family from ARN '$TaskDefinitionArn' — unexpected format."
    }
    return $Matches[1]
}

function Assert-SingleEcsTaskDefinitionArn {
    <#
      Validates that a captured "ARN" is actually a single scalar ECS
      task-definition ARN belonging to the expected family, before it is
      ever used in a mutating AWS CLI call (--task-definition ...).

      Exists because PowerShell collects EVERY object emitted to a
      function's success stream into the capturing variable — including
      any uncaptured/unsuppressed AWS CLI JSON output a callee happened to
      print along the way. A caller like `$newArn = SomeFunction ...` can
      silently end up with $newArn as a multi-element array (JSON text
      lines followed by the real ARN) instead of a single string; spreading
      that array into `@("--task-definition", $newArn, ...)` then supplies
      every element as a SEPARATE CLI argument, so AWS CLI reads only the
      first of them — never the real ARN — as --task-definition's value.
      That is exactly the STEP I "Invalid revision number" rollout failure
      this guards against.

      $Value is deliberately untyped (not [string]) so a genuinely polluted
      multi-item array is preserved for inspection rather than silently
      $OFS-joined into one garbled (and separately still-invalid) string by
      PowerShell's own parameter-binding coercion.

      Throws (terminating error, never returns a fallback) if $Value is not
      a single non-empty string matching the expected ECS task-definition
      ARN shape and family.
    #>
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$ExpectedFamily
    )

    if ($Value -is [array]) {
        throw "Expected a single task-definition ARN but captured $($Value.Count) values instead (likely uncaptured AWS CLI output leaking into a success stream): $($Value -join ' | ')"
    }
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) {
        throw "Expected a single non-empty task-definition ARN string, got: '$Value'"
    }
    $actualFamily = Get-EcsTaskFamilyFromArn -TaskDefinitionArn $Value
    if ($actualFamily -ne $ExpectedFamily) {
        throw "Task-definition ARN '$Value' belongs to family '$actualFamily', expected '$ExpectedFamily'."
    }
    return $Value
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

function Register-EcsTaskDefinitionWithImage {
    <#
      The single reusable describe -> patch-image -> register primitive for
      every ECS task-definition rollout in this repo (web, worker, and
      migrate). Fetches the CURRENTLY REGISTERED revision of $Family,
      replaces only the named container's `image`, and registers a new
      revision that otherwise preserves every field register-task-definition
      accepts: execution role, task role, cpu/memory, network mode, runtime
      platform, volumes, and — because containerDefinitions is carried
      through untouched apart from the one `image` field — every container's
      own environment variables and secret ARN mappings.
      Deliberately does NOT touch any ECS service; the caller decides
      whether/how the new revision gets deployed (a standing service via
      Update-EcsServiceImage below, or a one-off `aws ecs run-task` for the
      migrate family, which has no service at all).

      Never prints environment or secret VALUES — describe-task-definition's
      `secrets` entries are ARN references only (never resolved values), and
      this function's own output is limited to the previous/new image and
      the new task-definition ARN.

      Returns the new task-definition ARN, or exits non-zero (never returns)
      on any describe/register failure — callers must never fall back to a
      previously-known-good ARN silently.
    #>
    param(
        [Parameter(Mandatory)][string]$Family,
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][string]$ImageUri
    )

    Write-Step "Fetching current task definition ($Family)"
    $current = aws ecs describe-task-definition --task-definition $Family --output json --profile $env:AWS_PROFILE --region $env:AWS_REGION | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Could not describe task definition '$Family' (exit $LASTEXITCODE). Has 'terraform apply' created it yet?"
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
    # everything describe-task-definition adds that isn't a valid input
    # field (revision, taskDefinitionArn, status, registeredAt/By,
    # requiresAttributes, compatibilities). Every field kept here is
    # preserved from the CURRENTLY REGISTERED revision verbatim except
    # containerDefinitions[].image, which was patched above.
    $registerPayload = [ordered]@{
        family                  = $taskDef.family
        containerDefinitions    = $taskDef.containerDefinitions
        requiresCompatibilities = $taskDef.requiresCompatibilities
        networkMode             = $taskDef.networkMode
        cpu                     = $taskDef.cpu
        memory                  = $taskDef.memory
        executionRoleArn        = $taskDef.executionRoleArn
        taskRoleArn             = $taskDef.taskRoleArn
        volumes                 = $taskDef.volumes
    }
    # runtimePlatform is only present on task definitions that set it
    # explicitly (this stack's Fargate task defs currently don't — they take
    # the default X86_64/LINUX). Omit the key entirely rather than sending a
    # null, which register-task-definition rejects.
    if ($taskDef.PSObject.Properties.Name -contains "runtimePlatform" -and $taskDef.runtimePlatform) {
        $registerPayload["runtimePlatform"] = $taskDef.runtimePlatform
    }

    $tmpFile = New-TemporaryFile
    try {
        ($registerPayload | ConvertTo-Json -Depth 30) | Set-Content -Path $tmpFile -Encoding utf8

        Write-Step "Registering new task definition revision"
        $registered = aws ecs register-task-definition --cli-input-json "file://$tmpFile" --output json --profile $env:AWS_PROFILE --region $env:AWS_REGION | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "aws ecs register-task-definition failed for family '$Family' (exit $LASTEXITCODE)"
            exit 1
        }
        $newArn = $registered.taskDefinition.taskDefinitionArn
        $newArn = Assert-SingleEcsTaskDefinitionArn -Value $newArn -ExpectedFamily $Family
        Write-Success "Registered: $newArn"
        return $newArn
    } finally {
        Remove-Item $tmpFile -ErrorAction SilentlyContinue
    }
}

function Update-EcsServiceImage {
    <#
      Registers a new revision of an ECS task definition family with a
      patched container image (via Register-EcsTaskDefinitionWithImage),
      then updates the given STANDING SERVICE to use it and forces a fresh
      deployment. Shared by update-web-service.ps1 and
      update-worker-service.ps1 — both do the exact same
      register/update/wait sequence, only the cluster/service/family/
      container name differ. Not used for migrate, which has no service
      (see Register-EcsTaskDefinitionWithImage's own docs).
    #>
    param(
        [Parameter(Mandatory)][string]$Cluster,
        [Parameter(Mandatory)][string]$Service,
        [Parameter(Mandatory)][string]$Family,
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][string]$ImageUri
    )

    $newArn = Register-EcsTaskDefinitionWithImage -Family $Family -ContainerName $ContainerName -ImageUri $ImageUri
    $newArn = Assert-SingleEcsTaskDefinitionArn -Value $newArn -ExpectedFamily $Family

    Write-Step "Updating service '$Service' to the new revision (force new deployment)"
    # `--output json` writes the full updated-service description to stdout;
    # piped to Out-Null so it can never leak into this function's own success
    # stream (Invoke-Checked itself returns whatever its wrapped command
    # emits) and get silently appended to $newArn by the caller's capture —
    # see Assert-SingleEcsTaskDefinitionArn's docs for the failure this
    # caused.
    Invoke-Checked -FilePath "aws" -ArgumentList @(
        "ecs", "update-service",
        "--cluster", $Cluster,
        "--service", $Service,
        "--task-definition", $newArn,
        "--force-new-deployment",
        "--profile", $env:AWS_PROFILE,
        "--region", $env:AWS_REGION,
        "--output", "json"
    ) -FailureMessage "aws ecs update-service failed" | Out-Null

    Write-Step "Waiting for service to stabilize (AWS CLI default waiter: ~10 min max)"
    aws ecs wait services-stable --cluster $Cluster --services $Service --profile $env:AWS_PROFILE --region $env:AWS_REGION | Out-Null
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

function Assert-EcrImageApproved {
    <#
      Confirms an image tag exists in ECR and passes the scan gate: scan
      status COMPLETE with zero CRITICAL/HIGH findings (MEDIUM/LOW are
      reported but not gated). Exits non-zero (never returns) on any
      failure — a caller must never proceed to deploy an image this
      function didn't explicitly approve.

      Resolves the underlying PLATFORM-SPECIFIC manifest digest first: a
      `docker buildx` multi-arch push (with the default provenance/SBOM
      attestation) registers an OCI image INDEX, and ECR's scanner attaches
      findings to the platform manifest digest INSIDE that index, never to
      the index's own top-level digest — querying
      describe-image-scan-findings against the tag/index digest directly
      returns ScanNotFoundException forever, which looks identical to "scan
      still pending" if not handled explicitly.

      Never prints finding details beyond the CRITICAL/HIGH/MEDIUM/LOW
      counts.
    #>
    param(
        [Parameter(Mandatory)][string]$RepositoryName,
        [Parameter(Mandatory)][string]$ImageTag,
        [string]$Platform = "amd64",
        [int]$TimeoutSeconds = 300
    )

    Write-Step "Resolving platform-specific digest for ${RepositoryName}:${ImageTag}"
    $batchGet = aws ecr batch-get-image --repository-name $RepositoryName --image-ids imageTag=$ImageTag --profile $env:AWS_PROFILE --region $env:AWS_REGION --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "aws ecr batch-get-image failed for ${RepositoryName}:${ImageTag} (exit $LASTEXITCODE)"
        exit 1
    }
    if (-not $batchGet.images -or $batchGet.images.Count -eq 0) {
        Write-Fail "Image tag '$ImageTag' not found in repository '$RepositoryName'. Has it been pushed?"
        exit 1
    }
    $manifest = $batchGet.images[0].imageManifest | ConvertFrom-Json

    if ($manifest.manifests) {
        # OCI image index / Docker manifest list (buildx multi-arch + attestation).
        $platformManifest = $manifest.manifests | Where-Object {
            $_.platform -and $_.platform.architecture -eq $Platform -and $_.platform.os -eq "linux"
        } | Select-Object -First 1
        if (-not $platformManifest) {
            Write-Fail "No linux/$Platform manifest found inside the image index for ${RepositoryName}:${ImageTag}."
            exit 1
        }
        $digest = $platformManifest.digest
    } else {
        # Single-manifest image — the tag's own digest is what's scanned.
        $digest = $batchGet.images[0].imageId.imageDigest
    }
    Write-Success "Resolved digest: $digest"

    Write-Step "Waiting for ECR scan to complete (timeout ${TimeoutSeconds}s)"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $status = $null
    $findings = $null
    while ((Get-Date) -lt $deadline) {
        $result = aws ecr describe-image-scan-findings --repository-name $RepositoryName --image-id imageDigest=$digest --profile $env:AWS_PROFILE --region $env:AWS_REGION --output json 2>$null | ConvertFrom-Json
        if ($LASTEXITCODE -eq 0 -and $result -and $result.imageScanStatus) {
            $status = $result.imageScanStatus.status
            $findings = $result.imageScanFindings
            if ($status -eq "COMPLETE" -or $status -eq "FAILED") { break }
        }
        Start-Sleep -Seconds 10
    }

    if ($status -ne "COMPLETE") {
        Write-Fail "ECR scan for digest $digest did not reach COMPLETE within ${TimeoutSeconds}s (last status: $status)."
        exit 1
    }

    $counts = if ($findings -and $findings.findingSeverityCounts) { $findings.findingSeverityCounts } else { $null }
    $critical = if ($counts -and $counts.CRITICAL) { [int]$counts.CRITICAL } else { 0 }
    $high = if ($counts -and $counts.HIGH) { [int]$counts.HIGH } else { 0 }
    $medium = if ($counts -and $counts.MEDIUM) { [int]$counts.MEDIUM } else { 0 }
    $low = if ($counts -and $counts.LOW) { [int]$counts.LOW } else { 0 }

    Write-Success "Scan COMPLETE — CRITICAL=$critical HIGH=$high MEDIUM=$medium LOW=$low"
    if ($critical -gt 0 -or $high -gt 0) {
        Write-Fail "Image ${RepositoryName}:${ImageTag} (digest $digest) has $critical CRITICAL and $high HIGH finding(s) — scan gate failed."
        exit 1
    }

    return [pscustomobject]@{
        Digest   = $digest
        Critical = $critical
        High     = $high
        Medium   = $medium
        Low      = $low
    }
}

function Get-SecretCurrentVersionId {
    <#
      Returns the Secrets Manager version id currently staged AWSCURRENT
      for the given secret, using describe-secret (metadata only — this
      NEVER calls get-secret-value and therefore never fetches, holds, or
      risks printing the actual secret content). Used purely for
      before/after rollback bookkeeping in deployment reports.
    #>
    param([Parameter(Mandatory)][string]$SecretId)

    $desc = aws secretsmanager describe-secret --secret-id $SecretId --profile $env:AWS_PROFILE --region $env:AWS_REGION --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Could not describe secret '$SecretId' (exit $LASTEXITCODE)"
        exit 1
    }
    foreach ($prop in $desc.VersionIdsToStages.PSObject.Properties) {
        if ($prop.Value -contains "AWSCURRENT") {
            return $prop.Name
        }
    }
    Write-Fail "No AWSCURRENT version found for secret '$SecretId'"
    exit 1
}
