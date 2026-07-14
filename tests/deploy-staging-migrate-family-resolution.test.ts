import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Regression coverage for the STEP F rollout failure: deploy-staging.ps1
 * resolved the migrate task family via the Terraform output
 * "ecs_migrate_task_family" — an output that STEP G's own `terraform apply`
 * is what first creates in state. On the first coordinated rollout (state
 * predating that apply), STEP F failed before any secret rotation or
 * migration ever ran.
 *
 * Text/regex-based, matching tests/deploy-staging-rollout.test.ts's own
 * convention (no Pester dependency). \r?\n (never a bare \n across a line
 * boundary) tolerates this repo's CRLF checkout.
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

function stepFBlock(content: string): string {
  const match = content.match(/STEP F:[\s\S]*?STEP G:/);
  expect(match, "expected to find a STEP F...STEP G block in deploy-staging.ps1").not.toBeNull();
  return match![0];
}

describe("Requirement 1: STEP F resolves the migrate family without depending on the not-yet-applied output", () => {
  it("STEP F derives the family from $previousMigrateArn via Get-EcsTaskFamilyFromArn, not from ecs_migrate_task_family", () => {
    const block = stepFBlock(deployStaging());
    expect(block).toMatch(/\$migrateFamily\s*=\s*Get-EcsTaskFamilyFromArn\s+-TaskDefinitionArn\s+\$previousMigrateArn/);
    expect(block).not.toMatch(/Get-TerraformOutputRaw(Optional)?\s+"ecs_migrate_task_family"/);
  });

  it("$previousMigrateArn is captured in STEP B (from the already-applied ecs_migrate_task_definition_arn output), strictly before STEP F", () => {
    const content = deployStaging();
    const bIdx = content.indexOf('$previousMigrateArn = Get-TerraformOutputRaw "ecs_migrate_task_definition_arn"');
    const fIdx = content.indexOf("STEP F:");
    expect(bIdx).toBeGreaterThan(-1);
    expect(fIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeLessThan(fIdx);
  });

  it("Get-EcsTaskFamilyFromArn never itself calls terraform — pure string parsing, so it cannot be blocked by missing state", () => {
    const fn = common().match(/function Get-EcsTaskFamilyFromArn \{[\s\S]*?\r?\n\}\r?\n/);
    expect(fn).not.toBeNull();
    expect(fn![0]).not.toMatch(/terraform/i);
  });
});

describe("Requirement 2: the resolved family is exactly schoolsync-staging-migrate", () => {
  it("Get-EcsTaskFamilyFromArn resolves 'schoolsync-staging-migrate' from this account's real ARN shape, executed for real", () => {
    const out = runPwsh(
      `. "${commonPs1Path}"; Get-EcsTaskFamilyFromArn -TaskDefinitionArn "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-migrate:1"`
    );
    expect(out.trim()).toBe("schoolsync-staging-migrate");
  });

  it("resolves correctly regardless of revision number (generic parsing, not tied to :1)", () => {
    const out = runPwsh(
      `. "${commonPs1Path}"; Get-EcsTaskFamilyFromArn -TaskDefinitionArn "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-migrate:42"`
    );
    expect(out.trim()).toBe("schoolsync-staging-migrate");
  });
});

describe("Requirement 3: run-migrations.ps1 receives the exact newly registered migrate task-definition ARN", () => {
  const content = deployStaging();

  it("update-migrate-task.ps1's captured stdout ($newMigrateArn) is what gets passed to run-migrations.ps1 -TaskDefinitionArn", () => {
    expect(content).toMatch(/\$newMigrateArn\s*=\s*&\s*\(Join-Path \$PSScriptRoot "update-migrate-task\.ps1"\)/);
    expect(content).toMatch(/run-migrations\.ps1"\)\s*-TaskDefinitionArn\s*\$newMigrateArn/);
  });

  it("update-migrate-task.ps1 is invoked with an explicit -Family derived in STEP F, not left to resolve it internally", () => {
    const block = stepFBlock(content);
    expect(block).toMatch(/update-migrate-task\.ps1"\)\s*-ImageTag\s*\$ImageTag\s*-Family\s*\$migrateFamily/);
  });
});

describe("Requirement 4: secret rotation cannot happen before the migrate revision is registered", () => {
  const content = deployStaging();
  const indexOf = (label: string) => {
    const idx = content.indexOf(label);
    expect(idx, `expected to find "${label}"`).toBeGreaterThan(-1);
    return idx;
  };

  it("STEP F (family resolution + registration) precedes STEP G (terraform apply / secret rotation) in file order", () => {
    expect(indexOf("STEP F:")).toBeLessThan(indexOf("STEP G:"));
  });

  it("the registration-failure guard sits between STEP F's registration call and STEP G's terraform apply", () => {
    const block = stepFBlock(content);
    expect(block).toMatch(/if\s*\(\$LASTEXITCODE -ne 0 -or -not \$newMigrateArn\)/);
    expect(block.indexOf("exit 1")).toBeGreaterThan(block.indexOf("Get-EcsTaskFamilyFromArn"));
  });
});

describe("Requirement 5: failure to resolve/register the migrate revision stops before terraform apply", () => {
  const content = deployStaging();

  it("Get-EcsTaskFamilyFromArn's failure is never caught/swallowed inside STEP F — it terminates via $ErrorActionPreference=Stop", () => {
    const block = stepFBlock(content);
    expect(block).not.toMatch(/try\s*\{[\s\S]*Get-EcsTaskFamilyFromArn[\s\S]*catch/);
    expect(common()).toMatch(/\$ErrorActionPreference\s*=\s*"Stop"/);
  });

  it("Get-EcsTaskFamilyFromArn actually throws (terminating error) on a malformed ARN, rather than returning a guess", () => {
    expect(() =>
      runPwsh(`$ErrorActionPreference = "Stop"; . "${commonPs1Path}"; Get-EcsTaskFamilyFromArn -TaskDefinitionArn "not-a-valid-arn"`)
    ).toThrow();
  });

  it("a failed/empty registration still aborts with exit 1 before STEP G, unchanged from the original guard", () => {
    const block = stepFBlock(content);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/aborting BEFORE any secret rotation/);
  });
});

describe("Requirement 6: no fallback ever silently uses a stale task-definition ARN", () => {
  it("run-migrations.ps1 is always fed $newMigrateArn, never $previousMigrateArn", () => {
    const content = deployStaging();
    expect(content).toMatch(/run-migrations\.ps1"\)\s*-TaskDefinitionArn\s*\$newMigrateArn/);
    expect(content).not.toMatch(/run-migrations\.ps1"\)\s*-TaskDefinitionArn\s*\$previousMigrateArn/);
  });

  it("update-migrate-task.ps1's standalone fallback tries the Terraform-tracked family output first, non-fatally", () => {
    expect(updateMigrateTask()).toMatch(/Get-TerraformOutputRawOptional\s+"ecs_migrate_task_family"/);
  });

  it("the standalone fallback falls back only to the existing (already-applied) migrate ARN output, never a hardcoded/guessed family", () => {
    const content = updateMigrateTask();
    expect(content).toMatch(/Get-TerraformOutputRawOptional\s+"ecs_migrate_task_definition_arn"/);
    expect(content).toMatch(/Get-EcsTaskFamilyFromArn\s+-TaskDefinitionArn\s+\$existingArn/);
    // No literal migrate family string anywhere in actual code (doc-comment
    // blocks, which legitimately show example family names, are stripped).
    const codeOnly = content.replace(/<#[\s\S]*?#>/g, "");
    expect(codeOnly).not.toMatch(/"schoolsync-[a-z]+-migrate"/);
  });

  it("the standalone fallback fails closed (exit 1) if neither output is available, rather than guessing", () => {
    const content = updateMigrateTask();
    const fallbackBlock = content.match(/if\s*\(-not \$existingArn\)\s*\{[\s\S]*?\r?\n\s*\}/);
    expect(fallbackBlock).not.toBeNull();
    expect(fallbackBlock![0]).toMatch(/exit 1/);
    expect(fallbackBlock![0]).toMatch(/Refusing to guess a family name/);
  });
});

describe("Requirement 7: existing rollback reporting remains intact", () => {
  const content = deployStaging();

  it("the COORDINATED ROLLBACK block still reports previous/new migrate ARNs and secret version ids, never secret values", () => {
    const rollbackBlock = content.match(/COORDINATED ROLLBACK REQUIRED[\s\S]*?==============================\r?\n"/);
    const block = rollbackBlock ? rollbackBlock[0] : content.slice(content.indexOf("COORDINATED ROLLBACK REQUIRED"));
    expect(block).toMatch(/\$previousMigrateArn/);
    expect(block).toMatch(/\$newMigrateArn/);
    expect(block).toMatch(/\$previousSecretVersionId/);
    expect(block).toMatch(/\$newSecretVersionId/);
    expect(block).not.toMatch(/secret_string|SecretString/i);
  });

  it("the final success summary still reports previous/new task definitions and secret versions", () => {
    expect(content).toMatch(/Migrate task definition: previous=\$previousMigrateArn/);
    expect(content).toMatch(/Secrets Manager version: previous=\$previousSecretVersionId/);
  });
});

describe("Requirement 8: this suite's own line-spanning regexes tolerate both CRLF and LF checkouts", () => {
  // Both variants are derived explicitly from the file's own content
  // (normalized to LF, then re-expanded to CRLF) rather than assumed from
  // the ambient git checkout. A prior version of this suite asserted the
  // checkout itself was CRLF as a sanity check — true under a Windows
  // checkout (core.autocrlf=true converts the LF-stored blob on checkout)
  // but false on a Linux CI runner, which checks out the same blob
  // unmodified (its stored bytes contain zero \r; see infra/scripts'
  // .gitattributes — nothing there requests eol=crlf either). That made the
  // sanity check itself checkout-environment-dependent, and — silently
  // worse — meant the two "tolerance" tests below degraded to a trivial
  // LF-vs-LF comparison on any checkout that wasn't CRLF, never actually
  // exercising real CRLF content there. Deriving both variants here instead
  // makes the CRLF-tolerance guarantee unconditional, regardless of which
  // line ending the current checkout happens to produce.
  function bothLineEndings(content: string): { crlf: string; lf: string } {
    const lf = content.replace(/\r\n/g, "\n");
    return { crlf: lf.replace(/\n/g, "\r\n"), lf };
  }

  it("the function-block regexes used above match identically against CRLF and LF-normalized content", () => {
    const { crlf: crlfContent, lf: lfContent } = bothLineEndings(common());
    const pattern = /function Get-EcsTaskFamilyFromArn \{[\s\S]*?\r?\n\}\r?\n/;
    const crlfMatch = crlfContent.match(pattern);
    const lfMatch = lfContent.match(pattern);
    expect(crlfMatch).not.toBeNull();
    expect(lfMatch).not.toBeNull();
    // Same logical function body either way (normalize before comparing).
    expect(crlfMatch![0].replace(/\r\n/g, "\n")).toBe(lfMatch![0]);
  });

  it("the STEP F...STEP G block extraction used throughout this suite also tolerates either line ending", () => {
    const { crlf: crlfContent, lf: lfContent } = bothLineEndings(deployStaging());
    const crlfBlock = stepFBlock(crlfContent);
    const lfBlock = lfContent.match(/STEP F:[\s\S]*?STEP G:/)![0];
    expect(crlfBlock.replace(/\r\n/g, "\n")).toBe(lfBlock);
  });
});
