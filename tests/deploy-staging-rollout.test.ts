import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static/regression coverage for the coordinated ECS TLS rollout
 * (infra/scripts/deploy-staging.ps1 and friends). This is deliberately
 * text/regex-based, not Pester: the repo has no Pester dependency and
 * installing one solely for this task was out of scope. \r?\n (not a bare
 * \n) tolerates a CRLF checkout — see the equivalent note in
 * tests/email-iam-mapping.test.ts and tests/ecs-node-extra-ca-certs.test.ts.
 *
 * These tests assert on the ACTUAL text of the .ps1 files, so a future edit
 * that silently reorders steps, reintroduces a Terraform-output fallback
 * for the migrate ARN, or drops the root-identity guard fails loudly here
 * instead of only being caught by a live rollout against real AWS.
 */

const ROOT = process.cwd();
const scriptsDir = join(ROOT, "infra", "scripts");
const script = (name: string) => readFileSync(join(scriptsDir, name), "utf-8");

const deployStaging = () => script("deploy-staging.ps1");
const runMigrations = () => script("run-migrations.ps1");
const updateMigrateTask = () => script("update-migrate-task.ps1");
const common = () => script("common.ps1");

const CORE_ROLLOUT_SCRIPTS = [
  "deploy-staging.ps1",
  "run-migrations.ps1",
  "update-migrate-task.ps1",
  "update-web-service.ps1",
  "update-worker-service.ps1",
  "common.ps1",
];

describe("deploy-staging.ps1: required step ordering", () => {
  const content = deployStaging();

  // Each STEP label appears at least once; use the first occurrence to
  // establish relative order, since some steps (C, G's fmt/init/validate/
  // plan/apply) are logged multiple times in sequence.
  const indexOf = (label: string) => {
    const idx = content.indexOf(label);
    expect(idx, `expected to find "${label}" in deploy-staging.ps1`).toBeGreaterThan(-1);
    return idx;
  };

  it("web/worker CA-aware revisions (STEP C) are registered before the migrate revision (STEP F)", () => {
    expect(indexOf("STEP C:")).toBeLessThan(indexOf("STEP F:"));
  });

  it("the migrate revision (STEP F) is registered before secret rotation (STEP G)", () => {
    expect(indexOf("STEP F:")).toBeLessThan(indexOf("STEP G:"));
  });

  it("web/worker CA-aware revisions (STEP C) are registered before secret rotation (STEP G)", () => {
    expect(indexOf("STEP C:")).toBeLessThan(indexOf("STEP G:"));
  });

  it("secret rotation (STEP G) happens before migration runs (STEP H)", () => {
    expect(indexOf("STEP G:")).toBeLessThan(indexOf("STEP H:"));
  });

  it("migration (STEP H) happens before the final web/worker redeploy (STEP I)", () => {
    expect(indexOf("STEP H:")).toBeLessThan(indexOf("STEP I:"));
  });

  it("the redeploy (STEP I) happens before waiting for stability again (STEP J)", () => {
    expect(indexOf("STEP I:")).toBeLessThan(indexOf("STEP J:"));
  });

  it("readiness (STEP K) is polled after stabilization (STEP J), i.e. checked last", () => {
    expect(indexOf("STEP J:")).toBeLessThan(indexOf("STEP K:"));
  });

  it("liveness (STEP E) is verified before migration (STEP F/H) and does not require readiness", () => {
    expect(indexOf("STEP E:")).toBeLessThan(indexOf("STEP F:"));
    expect(content).toMatch(/STEP E:[\s\S]*?Verifying liveness only/);
    expect(content).not.toMatch(/STEP E:[\s\S]{0,400}check=readiness/);
  });
});

describe("deploy-staging.ps1: the migration command receives the newly registered ARN", () => {
  const content = deployStaging();

  it("update-migrate-task.ps1's captured output feeds run-migrations.ps1 directly", () => {
    expect(content).toMatch(/\$newMigrateArn\s*=\s*&\s*\(Join-Path \$PSScriptRoot "update-migrate-task\.ps1"\)/);
    expect(content).toMatch(/run-migrations\.ps1"\)\s*-TaskDefinitionArn\s*\$newMigrateArn/);
  });

  it("a failed migrate-task registration aborts before terraform apply / secret rotation", () => {
    const registerBlock = content.match(/STEP F:[\s\S]*?STEP G:/)![0];
    expect(registerBlock).toMatch(/if\s*\(\$LASTEXITCODE -ne 0 -or -not \$newMigrateArn\)/);
    expect(registerBlock).toMatch(/exit 1/);
  });

  it("services are only ever updated to $newWebArn/$newWorkerArn (script-verified), never a guessed or literal ARN", () => {
    const updateServiceCalls = content.match(/"--task-definition",\s*(\$\w+)/g) ?? [];
    expect(updateServiceCalls.length).toBeGreaterThan(0);
    for (const call of updateServiceCalls) {
      expect(call).toMatch(/\$(newWebArn|newWorkerArn)/);
    }
  });
});

describe("run-migrations.ps1: cannot silently fall back to a stale Terraform-tracked revision", () => {
  it("-TaskDefinitionArn is a mandatory parameter", () => {
    expect(runMigrations()).toMatch(/\[Parameter\(Mandatory\)\]\[string\]\$TaskDefinitionArn/);
  });

  it("never resolves the task definition from terraform output ecs_migrate_task_definition_arn", () => {
    expect(runMigrations()).not.toMatch(/Get-TerraformOutputRaw\s+"ecs_migrate_task_definition_arn"/);
  });

  it("captures the actual ECS container exit code and fails the script on a non-zero/missing exit code", () => {
    const content = runMigrations();
    expect(content).toMatch(/\$exitCode\s*=\s*\$container\.exitCode/);
    expect(content).toMatch(/if\s*\(\$null -eq \$exitCode -or \$exitCode -ne 0\)/);
  });

  it("never retries a failed or stuck migration task (no retry loop around run-task)", () => {
    const content = runMigrations();
    // The only loop in this script is the STOPPED-status poll, not a retry
    // of the actual `aws ecs run-task` invocation itself (a second textual
    // mention of "ecs run-task" is expected, in the failure log message).
    const invocations = (content.match(/\$runResult = aws ecs run-task/g) ?? []).length;
    expect(invocations).toBe(1);
  });
});

describe("update-migrate-task.ps1: registers without ever touching a live service", () => {
  const content = updateMigrateTask();

  it("calls the shared registration helper for the migrate family/container", () => {
    expect(content).toMatch(/Register-EcsTaskDefinitionWithImage/);
    expect(content).toMatch(/-ContainerName "migrate"/);
  });

  it("never calls update-service or run-task (registration only, no execution)", () => {
    expect(content).not.toMatch(/ecs update-service/);
    expect(content).not.toMatch(/ecs run-task/);
  });
});

describe("Seed and DNS are never invoked by the core rollout scripts", () => {
  it("no database seed command appears", () => {
    for (const name of CORE_ROLLOUT_SCRIPTS) {
      expect(script(name), name).not.toMatch(/prisma\s+db\s+seed|npm\s+run\s+seed/i);
    }
  });

  it("no DNS-mutating call appears (Route53 record changes)", () => {
    for (const name of CORE_ROLLOUT_SCRIPTS) {
      expect(script(name), name).not.toMatch(/change-resource-record-sets/i);
      expect(script(name), name).not.toMatch(/route53/i);
    }
  });
});

describe("No root or unverified default AWS profile can be used by deployment scripts", () => {
  it("Assert-AwsAuthenticated rejects any root ARN regardless of which profile produced it", () => {
    const fn = common().match(/function Assert-AwsAuthenticated \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).toMatch(/\^arn:aws:iam::\\d\+:root\$/);
    expect(fn).toMatch(/exit 1/);
  });

  it("Assert-AwsAuthenticated exports AWS_PROFILE/AWS_REGION so Terraform inherits the verified identity", () => {
    const fn = common().match(/function Assert-AwsAuthenticated \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).toMatch(/\$env:AWS_PROFILE\s*=\s*\$Profile/);
    expect(fn).toMatch(/\$env:AWS_REGION\s*=\s*\$script:DefaultAwsRegion/);
  });

  it("the default profile is schoolsync-admin, not a bare/unnamed default", () => {
    expect(common()).toMatch(/\$script:DefaultAwsProfile\s*=\s*"schoolsync-admin"/);
  });

  it("every core rollout script calls Assert-AwsAuthenticated before any AWS action", () => {
    for (const name of ["deploy-staging.ps1", "run-migrations.ps1", "update-migrate-task.ps1", "update-web-service.ps1", "update-worker-service.ps1", "preflight.ps1"]) {
      expect(script(name), name).toMatch(/Assert-AwsAuthenticated/);
    }
  });

  it("aws CLI invocations in the registration/rollout helpers resolve the profile via Get-AwsCliProfileArgs, never a bare hardcoded --profile", () => {
    // Sample the mutating calls specifically (register-task-definition,
    // update-service, run-task) rather than every aws invocation in the
    // file. These must use the shared @profileArgs splat (built from
    // Get-AwsCliProfileArgs) rather than a literal "--profile", $env:AWS_PROFILE
    // pair, so OIDC/CI mode (no profile) can omit the flag entirely instead
    // of passing an empty value — see the "OIDC/CI credential mode" tests
    // below.
    const mutatingCallBlocks = [
      ...(common().match(/\$registered = aws ecs register-task-definition[^\n]*/g) ?? []),
      ...(common().match(/\$updateServiceArgs = @\([\s\S]*?\) \+ \$profileArgs \+ @\([^\n]*\)/g) ?? []),
      ...(runMigrations().match(/\$runResult = aws ecs run-task[\s\S]*?ConvertFrom-Json/g) ?? []),
    ];
    expect(mutatingCallBlocks.length).toBeGreaterThan(0);
    for (const block of mutatingCallBlocks) {
      expect(block).toMatch(/profileArgs/);
      expect(block).not.toMatch(/"--profile",\s*\$env:AWS_PROFILE/);
    }
  });
});

describe("OIDC/CI credential mode (infra/scripts/common.ps1, deploy-staging.ps1)", () => {
  it("Get-AwsCliProfileArgs omits --profile entirely when AWS_PROFILE is unset, never passing an empty profile value", () => {
    const fn = common().match(/function Get-AwsCliProfileArgs \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).toMatch(/if \(\$env:AWS_PROFILE\) \{ return @\("--profile", \$env:AWS_PROFILE\) \}/);
    expect(fn).toMatch(/return @\(\)/);
  });

  it("Assert-AwsAuthenticated defaults to the schoolsync-admin profile unless SCHOOLSYNC_CI_OIDC=1 is set — local interactive behavior is unchanged", () => {
    const fn = common().match(/function Assert-AwsAuthenticated \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).toMatch(/param\(\[string\]\$Profile = \$\(if \(\$env:SCHOOLSYNC_CI_OIDC -eq "1"\) \{ "" \} else \{ \$script:DefaultAwsProfile \}\)\)/);
  });

  it("Assert-AwsAuthenticated clears $env:AWS_PROFILE (not an empty string) in OIDC mode", () => {
    const fn = common().match(/function Assert-AwsAuthenticated \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).toMatch(/Remove-Item Env:\\AWS_PROFILE -ErrorAction SilentlyContinue/);
  });

  it("deploy-staging.ps1 -UseOidcCredentials sets SCHOOLSYNC_CI_OIDC before dot-sourcing common.ps1", () => {
    const content = deployStaging();
    const oidcBlockIndex = content.indexOf('$env:SCHOOLSYNC_CI_OIDC = "1"');
    const dotSourceIndex = content.indexOf('. (Join-Path $PSScriptRoot "common.ps1")');
    expect(oidcBlockIndex).toBeGreaterThan(-1);
    expect(dotSourceIndex).toBeGreaterThan(-1);
    expect(oidcBlockIndex).toBeLessThan(dotSourceIndex);
  });

  it("every infra/scripts/*.ps1 entry point exposes -UseOidcCredentials", () => {
    for (const name of ["preflight.ps1", "run-migrations.ps1", "update-migrate-task.ps1", "update-web-service.ps1", "update-worker-service.ps1", "show-deployment-status.ps1", "deploy-staging.ps1"]) {
      expect(script(name), name).toMatch(/\[switch\]\$UseOidcCredentials/);
    }
  });
});

describe("RequireTerraformNoChanges CI safety mode (deploy-staging.ps1, common.ps1)", () => {
  it("Assert-TerraformNoChanges never runs terraform apply", () => {
    const fn = common().match(/function Assert-TerraformNoChanges \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).not.toMatch(/terraform"?\s*@?\(?"apply"/);
    expect(fn).toMatch(/-detailed-exitcode/);
  });

  it("Assert-TerraformNoChanges continues on exit code 0 and exits on 1 or 2", () => {
    const fn = common().match(/function Assert-TerraformNoChanges \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).toMatch(/\$code -eq 0/);
    expect(fn).toMatch(/\$code -eq 2/);
    expect(fn).toMatch(/exit 2/);
    expect(fn).toMatch(/exit 1/);
  });

  it("the no-change gate runs before STEP C (the first ECS mutation) when -RequireTerraformNoChanges is set", () => {
    const content = deployStaging();
    const gateIndex = content.indexOf("Assert-TerraformNoChanges -BackendConfig $backendConfig");
    const stepCIndex = content.indexOf("STEP C:");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(stepCIndex);
  });

  it("STEP G skips terraform apply entirely when -RequireTerraformNoChanges is set", () => {
    const content = deployStaging();
    const stepGBlock = content.match(/# ── G\. Terraform plan\/apply[\s\S]*?\$newSecretVersionId = Get-SecretCurrentVersionId/)![0];
    expect(stepGBlock).toMatch(/if \(\$RequireTerraformNoChanges\) \{/);
    expect(stepGBlock).toMatch(/skipping terraform apply/);
  });

  it("infrastructure changes cannot be auto-applied by this workflow: RequireTerraformNoChanges mode never calls the interactive/AutoApprove apply path", () => {
    const content = deployStaging();
    // The literal `"apply", "-input=false", "tfplan"` invocation must only
    // ever appear AFTER the CI-safety-mode branch of STEP G (i.e. inside the
    // `else` — non-CI, local operator — branch), never before/inside it.
    const applyIndex = content.indexOf('"apply", "-input=false", "tfplan"');
    const ciSafetyBranchIndex = content.indexOf("STEP G: CI safety mode");
    expect(applyIndex).toBeGreaterThan(-1);
    expect(ciSafetyBranchIndex).toBeGreaterThan(-1);
    expect(applyIndex).toBeGreaterThan(ciSafetyBranchIndex);
  });
});

describe("deploy-staging.ps1: -ExpectedAccountId remains mandatory", () => {
  it("is declared with [Parameter(Mandatory)]", () => {
    expect(deployStaging()).toMatch(/\[Parameter\(Mandatory\)\]\[string\]\$ExpectedAccountId/);
  });

  it("is checked against the authenticated identity before any Terraform/AWS mutating call", () => {
    const content = deployStaging();
    const accountCheckIndex = content.indexOf("Confirming AWS account matches -ExpectedAccountId");
    const firstTerraformCall = content.indexOf('"init"');
    const firstEcsRegisterCall = content.indexOf("Update-EcsServiceImage");
    expect(accountCheckIndex).toBeGreaterThan(-1);
    expect(accountCheckIndex).toBeLessThan(firstTerraformCall);
    expect(accountCheckIndex).toBeLessThan(firstEcsRegisterCall);
  });
});

describe("Native exit codes are checked, not masked by pipes", () => {
  it("deploy-staging.ps1 checks $LASTEXITCODE after every sub-script/native invocation it gates on", () => {
    const content = deployStaging();
    const lastExitCodeUses = (content.match(/\$LASTEXITCODE/g) ?? []).length;
    // One per: preflight, web-service describe, worker-service describe,
    // migrate registration, migration run (captured then checked), web
    // wait-stable, worker wait-stable — comfortably more than a handful.
    expect(lastExitCodeUses).toBeGreaterThanOrEqual(6);
  });

  it("Invoke-Checked (used for every Terraform/aws mutating call) checks $LASTEXITCODE and exits non-zero on failure", () => {
    const fn = common().match(/function Invoke-Checked \{[\s\S]*?\r?\n\}\r?\n/)![0];
    expect(fn).toMatch(/\$LASTEXITCODE -ne 0/);
    expect(fn).toMatch(/exit \$LASTEXITCODE/);
  });

  it("run-migrations.ps1 captures aws ecs run-task's exit code across the ConvertFrom-Json pipe correctly", () => {
    const content = runMigrations();
    const runTaskBlock = content.match(/\$runResult = aws ecs run-task[\s\S]*?ConvertFrom-Json/)![0];
    expect(runTaskBlock).toMatch(/\| ConvertFrom-Json$/);
    // The exit-code check must come from the native `aws` call, not be
    // reset by the ConvertFrom-Json cmdlet in the same pipeline.
    const afterPipe = content.slice(content.indexOf(runTaskBlock) + runTaskBlock.length);
    expect(afterPipe).toMatch(/^\s*\r?\n\s*if\s*\(\$LASTEXITCODE -ne 0\)/);
  });
});

describe("Dockerfile CA-trust fix is baked in, not deployment-script-dependent (cross-check)", () => {
  it("Dockerfile is referenced as the source of NODE_EXTRA_CA_CERTS in the README rollout notes, not ecs.tf alone", () => {
    const readme = readFileSync(join(ROOT, "infra", "terraform", "README.md"), "utf-8");
    expect(readme).toMatch(/NODE_EXTRA_CA_CERTS[\s\S]*?baked into the Dockerfile|Dockerfile[\s\S]*?NODE_EXTRA_CA_CERTS/);
  });
});
