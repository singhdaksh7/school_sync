import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Regression coverage for the STEP F rollout failure: deploy-staging.ps1
 * used to resolve the migrate task family via the Terraform output
 * "ecs_migrate_task_family" — an output that STEP G's own `terraform
 * apply` is what first creates. On a first coordinated rollout against
 * state that predates that apply, STEP F failed before any secret
 * rotation or migration ever ran.
 *
 * Text/regex-based, matching tests/deploy-staging-rollout.test.ts's own
 * convention (no Pester dependency). \r?\n tolerates a CRLF checkout.
 */

const ROOT = process.cwd();
const scriptsDir = join(ROOT, "infra", "scripts");
const script = (name: string) => readFileSync(join(scriptsDir, name), "utf-8");

const deployStaging = () => script("deploy-staging.ps1");
const updateMigrateTask = () => script("update-migrate-task.ps1");
const common = () => script("common.ps1");
const commonPs1Path = join(scriptsDir, "common.ps1");

function runPwsh(command: string): string {
  return execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf-8",
  });
}

describe("Requirement 1+6: deploy-staging.ps1's STEP F never depends on the not-yet-applied output", () => {
  const content = deployStaging();

  it("resolves the migrate family from the already-existing ecs_migrate_task_definition_arn (via $previousMigrateArn), not ecs_migrate_task_family", () => {
    const stepFBlock = content.match(/STEP F:[\s\S]*?STEP G:/)![0];
    expect(stepFBlock).toMatch(/Get-EcsTaskFamilyFromArn\s+-TaskDefinitionArn\s+\$previousMigrateArn/);
    // The primary rollout path must not call the not-yet-applied output at all.
    expect(stepFBlock).not.toMatch(/Get-TerraformOutputRaw(Optional)?\s+"ecs_migrate_task_family"/);
  });

  it("passes the resolved family explicitly into update-migrate-task.ps1 (-Family), not relying on its own internal Terraform lookup", () => {
    const stepFBlock = content.match(/STEP F:[\s\S]*?STEP G:/)![0];
    expect(stepFBlock).toMatch(/update-migrate-task\.ps1"\)\s*-ImageTag\s*\$ImageTag\s*-Family\s*\$migrateFamily/);
  });

  it("$previousMigrateArn (used to derive family) is captured in STEP B, strictly before STEP F runs", () => {
    const bIdx = content.indexOf('$previousMigrateArn = Get-TerraformOutputRaw "ecs_migrate_task_definition_arn"');
    const fIdx = content.indexOf("STEP F:");
    expect(bIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeLessThan(fIdx);
  });

  it("no fallback ever substitutes the previous/stale ARN for the newly registered one: run-migrations.ps1 is always fed $newMigrateArn", () => {
    expect(content).toMatch(/run-migrations\.ps1"\)\s*-TaskDefinitionArn\s*\$newMigrateArn/);
    expect(content).not.toMatch(/run-migrations\.ps1"\)\s*-TaskDefinitionArn\s*\$previousMigrateArn/);
  });
});

describe("Requirement 2: Get-EcsTaskFamilyFromArn resolves the real family, executed for real (not just pattern-matched)", () => {
  it("resolves 'schoolsync-staging-migrate' from the actual ARN shape seen in this AWS account", () => {
    const out = runPwsh(
      `. "${commonPs1Path}"; Get-EcsTaskFamilyFromArn -TaskDefinitionArn "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-migrate:1"`
    );
    expect(out.trim()).toBe("schoolsync-staging-migrate");
  });

  it("fails closed (terminating error) on a malformed ARN rather than guessing a family", () => {
    expect(() =>
      runPwsh(
        `$ErrorActionPreference = "Stop"; . "${commonPs1Path}"; Get-EcsTaskFamilyFromArn -TaskDefinitionArn "not-a-valid-arn"`
      )
    ).toThrow();
  });

  it("also resolves correctly for the web/worker-shaped families (generic parsing, not migrate-specific)", () => {
    const out = runPwsh(
      `. "${commonPs1Path}"; Get-EcsTaskFamilyFromArn -TaskDefinitionArn "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-web:2"`
    );
    expect(out.trim()).toBe("schoolsync-staging-web");
  });
});

describe("Requirement 5: failure to resolve/register the migrate revision stops before terraform apply", () => {
  const content = deployStaging();

  it("Get-EcsTaskFamilyFromArn's failure is never caught/swallowed inside STEP F (fails closed via the global Stop preference)", () => {
    const stepFBlock = content.match(/STEP F:[\s\S]*?STEP G:/)![0];
    expect(stepFBlock).not.toMatch(/try\s*\{[\s\S]*Get-EcsTaskFamilyFromArn[\s\S]*catch/);
  });

  it("$ErrorActionPreference is Stop, so an unhandled throw in STEP F terminates before reaching STEP G", () => {
    expect(common()).toMatch(/\$ErrorActionPreference\s*=\s*"Stop"/);
  });

  it("a failed/empty registration still aborts with exit 1 before STEP G, unchanged from the original guard", () => {
    const stepFBlock = content.match(/STEP F:[\s\S]*?STEP G:/)![0];
    expect(stepFBlock).toMatch(/if\s*\(\$LASTEXITCODE -ne 0 -or -not \$newMigrateArn\)/);
    expect(stepFBlock).toMatch(/exit 1/);
    expect(stepFBlock).toMatch(/aborting BEFORE any secret rotation/);
  });

  it("STEP F (including family resolution) precedes STEP G in file order", () => {
    expect(content.indexOf("STEP F:")).toBeLessThan(content.indexOf("STEP G:"));
  });
});

describe("Requirement 4: secret rotation ordering is unchanged by this fix", () => {
  const content = deployStaging();

  it("web/worker (STEP C) still precede the migrate revision (STEP F), which still precedes secret rotation (STEP G)", () => {
    expect(content.indexOf("STEP C:")).toBeLessThan(content.indexOf("STEP F:"));
    expect(content.indexOf("STEP F:")).toBeLessThan(content.indexOf("STEP G:"));
  });

  it("STEP G (terraform apply / secret rotation) still precedes migration execution (STEP H)", () => {
    expect(content.indexOf("STEP G:")).toBeLessThan(content.indexOf("STEP H:"));
  });
});

describe("Requirement 3: update-migrate-task.ps1 still hands back the newly registered ARN for run-migrations.ps1", () => {
  const content = updateMigrateTask();

  it("registers via the shared helper for the migrate family/container and returns its ARN as the final stdout line", () => {
    expect(content).toMatch(/Register-EcsTaskDefinitionWithImage/);
    expect(content).toMatch(/-ContainerName "migrate"/);
    expect(content.trim().split(/\r?\n/).slice(-2, -1)[0].trim()).toBe("$newArn");
  });

  it("accepts an optional -Family so the caller (deploy-staging.ps1) can supply it explicitly", () => {
    expect(content).toMatch(/\[string\]\$Family\r?\n\)/);
  });
});

describe("Requirement 6 (standalone path): the fallback never silently uses a stale/guessed family", () => {
  const content = updateMigrateTask();

  it("standalone resolution tries the Terraform-tracked family output first, non-fatally", () => {
    expect(content).toMatch(/Get-TerraformOutputRawOptional\s+"ecs_migrate_task_family"/);
  });

  it("falls back only to the existing (already-applied) migrate ARN output, never a hardcoded or guessed family", () => {
    expect(content).toMatch(/Get-TerraformOutputRawOptional\s+"ecs_migrate_task_definition_arn"/);
    expect(content).toMatch(/Get-EcsTaskFamilyFromArn\s+-TaskDefinitionArn\s+\$existingArn/);
    // No literal family string anywhere in actual code (comment-block docs,
    // which legitimately show example family names, are stripped first).
    const codeOnly = content.replace(/<#[\s\S]*?#>/g, "");
    expect(codeOnly).not.toMatch(/"schoolsync-[a-z]+-migrate"/);
  });

  it("fails closed (exit 1) if neither output is available, rather than guessing", () => {
    const fallbackBlock = content.match(/Write-Warn "'ecs_migrate_task_family'[\s\S]*?\r?\n\}/)![0];
    expect(fallbackBlock).toMatch(/if\s*\(-not \$existingArn\)/);
    expect(fallbackBlock).toMatch(/exit 1/);
    expect(fallbackBlock).toMatch(/Refusing to guess a family name/);
  });
});

describe("Requirement 7: existing rollback reporting remains intact", () => {
  const content = deployStaging();

  it("the COORDINATED ROLLBACK block still reports previous/new migrate ARNs and secret version ids, never values", () => {
    const match = content.match(/COORDINATED ROLLBACK REQUIRED[\s\S]*?exit 1/);
    expect(match).not.toBeNull();
    const rollbackBlock = match![0];
    expect(rollbackBlock).toMatch(/\$previousMigrateArn/);
    expect(rollbackBlock).toMatch(/\$newMigrateArn/);
    expect(rollbackBlock).toMatch(/\$previousSecretVersionId/);
    expect(rollbackBlock).toMatch(/\$newSecretVersionId/);
    expect(rollbackBlock).not.toMatch(/secret_string|SecretString/i);
  });

  it("the final success summary still reports previous/new task definitions and secret versions", () => {
    expect(content).toMatch(/Migrate task definition: previous=\$previousMigrateArn/);
    expect(content).toMatch(/Secrets Manager version: previous=\$previousSecretVersionId/);
  });
});

describe("Requirement 8: CRLF-safety", () => {
  it("the scripts under test are actually CRLF-checked-out, so the passing assertions above prove real CRLF tolerance, not just LF luck", () => {
    expect(deployStaging()).toMatch(/\r\n/);
    expect(updateMigrateTask()).toMatch(/\r\n/);
    expect(common()).toMatch(/\r\n/);
  });

  it("this file's own multi-line boundary patterns use the \\r?\\n idiom, matching tests/deploy-staging-rollout.test.ts's convention", () => {
    const selfSrc = readFileSync(__filename, "utf-8");
    const crlfTolerantPatternCount = (selfSrc.match(/\\r\?\\n/g) ?? []).length;
    expect(crlfTolerantPatternCount).toBeGreaterThan(0);
  });
});
