import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Regression coverage for the STEP I rollout failure: `$newWebArn` (captured
 * at STEP C from `Update-EcsServiceImage`) was actually a multi-element
 * PowerShell array — the raw JSON stdout of the internal
 * `aws ecs update-service --output json` call, followed by the real ARN —
 * because that call's output was never captured/suppressed, so it leaked
 * into `Update-EcsServiceImage`'s own success stream and got collected into
 * the caller's variable alongside the intended `return $newArn`. Spreading
 * that polluted array into STEP I's `@("--task-definition", $newWebArn, ...)`
 * then supplied every JSON line as a separate CLI argument ahead of the real
 * ARN, so AWS CLI rejected the first of them as an invalid revision.
 *
 * Text/regex-based, matching the existing convention in
 * tests/deploy-staging-rollout.test.ts and
 * tests/deploy-staging-migrate-family-resolution.test.ts (no Pester
 * dependency). \r?\n (never a bare \n across a line boundary) tolerates
 * this repo's CRLF checkout.
 */

const ROOT = process.cwd();
const scriptsDir = join(ROOT, "infra", "scripts");
const script = (name: string) => readFileSync(join(scriptsDir, name), "utf-8");
const commonPs1Path = join(scriptsDir, "common.ps1");

const deployStaging = () => script("deploy-staging.ps1");
const updateMigrateTask = () => script("update-migrate-task.ps1");
const common = () => script("common.ps1");

function runPwsh(command: string): string {
  return execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf-8",
  });
}

function functionBlock(source: string, name: string): string {
  const re = new RegExp(`function ${name} \\{[\\s\\S]*?\\r?\\n\\}\\r?\\n`);
  const match = source.match(re);
  expect(match, `expected to find function ${name} in the source`).not.toBeNull();
  return match![0];
}

function stepBlock(content: string, fromLabel: string, toLabel: string): string {
  const re = new RegExp(`${fromLabel}[\\s\\S]*?${toLabel}`);
  const match = content.match(re);
  expect(match, `expected a ${fromLabel} ... ${toLabel} block`).not.toBeNull();
  return match![0];
}

describe("Requirement 1: AWS update-service JSON cannot contaminate the returned ARN", () => {
  it("Update-EcsServiceImage suppresses the update-service call's --output json stdout (piped to Out-Null)", () => {
    const fn = functionBlock(common(), "Update-EcsServiceImage");
    expect(fn).toMatch(/"aws ecs update-service failed"\s*\|\s*Out-Null/);
  });

  it("Update-EcsServiceImage also suppresses the wait services-stable call's stdout", () => {
    const fn = functionBlock(common(), "Update-EcsServiceImage");
    expect(fn).toMatch(/aws ecs wait services-stable[^\r\n]*\|\s*Out-Null/);
  });

  it("Register-EcsTaskDefinitionWithImage's own AWS CLI calls remain captured via assignment (never bare/leaked)", () => {
    const fn = functionBlock(common(), "Register-EcsTaskDefinitionWithImage");
    expect(fn).toMatch(/\$current\s*=\s*aws ecs describe-task-definition/);
    expect(fn).toMatch(/\$registered\s*=\s*aws ecs register-task-definition/);
  });
});

describe("Requirement 2: web and worker ARN variables are validated as exactly one scalar ARN", () => {
  const content = deployStaging();

  it("STEP C validates $newWebArn immediately after capture, before STEP E", () => {
    const block = stepBlock(content, "STEP C:", "STEP E:");
    expect(block).toMatch(/\$newWebArn\s*=\s*Assert-SingleEcsTaskDefinitionArn\s+-Value\s+\$newWebArn\s+-ExpectedFamily\s+\$webFamily/);
  });

  it("STEP C validates $newWorkerArn immediately after capture, before STEP E", () => {
    const block = stepBlock(content, "STEP C:", "STEP E:");
    expect(block).toMatch(/\$newWorkerArn\s*=\s*Assert-SingleEcsTaskDefinitionArn\s+-Value\s+\$newWorkerArn\s+-ExpectedFamily\s+\$workerFamily/);
  });

  it("Update-EcsServiceImage validates its own $newArn before using it in the update-service call", () => {
    const fn = functionBlock(common(), "Update-EcsServiceImage");
    const registerIdx = fn.indexOf("Register-EcsTaskDefinitionWithImage");
    const assertIdx = fn.indexOf("Assert-SingleEcsTaskDefinitionArn");
    const updateServiceIdx = fn.indexOf('"ecs", "update-service"');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeGreaterThan(registerIdx);
    expect(updateServiceIdx).toBeGreaterThan(assertIdx);
  });
});

describe("Requirement 3: STEP I passes only the validated ARN to --task-definition", () => {
  const content = deployStaging();

  it("STEP I's web update-service call passes exactly $newWebArn (a single reference, not concatenated/joined)", () => {
    const block = stepBlock(content, "STEP I:", "STEP J:");
    expect(block).toMatch(/"--task-definition",\s*\$newWebArn,/);
  });

  it("STEP I's worker update-service call passes exactly $newWorkerArn", () => {
    const block = stepBlock(content, "STEP I:", "STEP J:");
    expect(block).toMatch(/"--task-definition",\s*\$newWorkerArn,/);
  });

  it("no --task-definition argument in STEP I is ever followed by additional array elements before the next flag", () => {
    const block = stepBlock(content, "STEP I:", "STEP J:");
    // Every --task-definition line is immediately followed by exactly one
    // variable then a comma and the next named flag — never a bare list or
    // string concatenation that could hide extra elements.
    const matches = [...block.matchAll(/"--task-definition",\s*([^\r\n,]+),/g)];
    expect(matches.length).toBe(2);
    for (const m of matches) {
      expect(m[1].trim()).toMatch(/^\$new(Web|Worker)Arn$/);
    }
  });
});

describe("Requirement 4: invalid/multi-value output stops before any service mutation", () => {
  it("Assert-SingleEcsTaskDefinitionArn throws on a genuinely polluted multi-value array, executed for real", () => {
    expect(() =>
      runPwsh(
        `$ErrorActionPreference = "Stop"; . "${commonPs1Path}"; ` +
          `Assert-SingleEcsTaskDefinitionArn -Value @("{", "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-web:5") -ExpectedFamily "schoolsync-staging-web"`
      )
    ).toThrow();
  });

  it("Assert-SingleEcsTaskDefinitionArn throws on a single value that isn't a valid ARN", () => {
    expect(() =>
      runPwsh(
        `$ErrorActionPreference = "Stop"; . "${commonPs1Path}"; ` +
          `Assert-SingleEcsTaskDefinitionArn -Value "not-an-arn" -ExpectedFamily "schoolsync-staging-web"`
      )
    ).toThrow();
  });

  it("Assert-SingleEcsTaskDefinitionArn throws when the ARN belongs to the wrong family", () => {
    expect(() =>
      runPwsh(
        `$ErrorActionPreference = "Stop"; . "${commonPs1Path}"; ` +
          `Assert-SingleEcsTaskDefinitionArn -Value "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-worker:2" -ExpectedFamily "schoolsync-staging-web"`
      )
    ).toThrow();
  });

  it("Assert-SingleEcsTaskDefinitionArn returns the value unchanged when genuinely valid", () => {
    const out = runPwsh(
      `. "${commonPs1Path}"; ` +
        `Assert-SingleEcsTaskDefinitionArn -Value "arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-web:5" -ExpectedFamily "schoolsync-staging-web"`
    );
    expect(out.trim()).toBe("arn:aws:ecs:ap-south-1:928805968612:task-definition/schoolsync-staging-web:5");
  });

  it("STEP C's validation of $newWebArn/$newWorkerArn precedes STEP G (terraform apply) and STEP I (the mutating redeploy) in file order", () => {
    const content = deployStaging();
    const cBlock = stepBlock(content, "STEP C:", "STEP E:");
    const lastAssertIdxInC = cBlock.lastIndexOf("Assert-SingleEcsTaskDefinitionArn");
    expect(lastAssertIdxInC).toBeGreaterThan(-1);
    expect(content.indexOf("STEP G:")).toBeGreaterThan(content.indexOf("STEP C:"));
    expect(content.indexOf("STEP I:")).toBeGreaterThan(content.indexOf("STEP G:"));
  });

  it("Assert-SingleEcsTaskDefinitionArn's failure is never caught/swallowed around STEP C's validation calls", () => {
    const content = deployStaging();
    const cBlock = stepBlock(content, "STEP C:", "STEP E:");
    expect(cBlock).not.toMatch(/try\s*\{[\s\S]*Assert-SingleEcsTaskDefinitionArn[\s\S]*catch/);
    expect(common()).toMatch(/\$ErrorActionPreference\s*=\s*"Stop"/);
  });
});

describe("Requirement 5: worker reload has equivalent protection to web", () => {
  it("update-worker-service.ps1 and update-web-service.ps1 both route through the same Update-EcsServiceImage helper (identical protection)", () => {
    expect(script("update-web-service.ps1")).toMatch(/Update-EcsServiceImage/);
    expect(script("update-worker-service.ps1")).toMatch(/Update-EcsServiceImage/);
  });

  it("deploy-staging.ps1 validates $newWorkerArn using the exact same helper/shape as $newWebArn (no asymmetric protection)", () => {
    const content = deployStaging();
    const cBlock = stepBlock(content, "STEP C:", "STEP E:");
    const webCall = cBlock.match(/Assert-SingleEcsTaskDefinitionArn\s+-Value\s+\$newWebArn\s+-ExpectedFamily\s+\$webFamily/);
    const workerCall = cBlock.match(/Assert-SingleEcsTaskDefinitionArn\s+-Value\s+\$newWorkerArn\s+-ExpectedFamily\s+\$workerFamily/);
    expect(webCall).not.toBeNull();
    expect(workerCall).not.toBeNull();
  });
});

describe("Requirement 6: migrate ARN handling remains protected", () => {
  it("update-migrate-task.ps1 validates its own $newArn before emitting it as the final stdout line", () => {
    const content = updateMigrateTask();
    const assertIdx = content.indexOf("Assert-SingleEcsTaskDefinitionArn");
    const finalEmitIdx = content.lastIndexOf("$newArn");
    expect(assertIdx).toBeGreaterThan(-1);
    // The bare `$newArn` emission line is the very last statement in the
    // file (before `exit 0`) — the validation call must precede it.
    expect(assertIdx).toBeLessThan(finalEmitIdx);
  });

  it("deploy-staging.ps1 STEP F validates $newMigrateArn before Write-Success and before STEP G", () => {
    const content = deployStaging();
    const fBlock = stepBlock(content, "STEP F:", "STEP G:");
    expect(fBlock).toMatch(/\$newMigrateArn\s*=\s*Assert-SingleEcsTaskDefinitionArn\s+-Value\s+\$newMigrateArn\s+-ExpectedFamily\s+\$migrateFamily/);
    const assertIdx = fBlock.indexOf("Assert-SingleEcsTaskDefinitionArn");
    const successIdx = fBlock.indexOf("Migrate task revision registered");
    expect(assertIdx).toBeLessThan(successIdx);
  });

  it("Register-EcsTaskDefinitionWithImage (shared by web/worker/migrate) validates before returning", () => {
    const fn = functionBlock(common(), "Register-EcsTaskDefinitionWithImage");
    const assertIdx = fn.indexOf("Assert-SingleEcsTaskDefinitionArn");
    const returnIdx = fn.indexOf("return $newArn");
    expect(assertIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(returnIdx);
  });
});

describe("Requirement 7: coordinated ordering is unchanged by this fix", () => {
  const content = deployStaging();
  const indexOf = (label: string) => {
    const idx = content.indexOf(label);
    expect(idx, `expected to find "${label}"`).toBeGreaterThan(-1);
    return idx;
  };

  it("STEP C precedes STEP F, which precedes STEP G, which precedes STEP H, which precedes STEP I", () => {
    expect(indexOf("STEP C:")).toBeLessThan(indexOf("STEP F:"));
    expect(indexOf("STEP F:")).toBeLessThan(indexOf("STEP G:"));
    expect(indexOf("STEP G:")).toBeLessThan(indexOf("STEP H:"));
    expect(indexOf("STEP H:")).toBeLessThan(indexOf("STEP I:"));
  });

  it("STEP I still precedes STEP J (stabilization wait) and STEP K (readiness)", () => {
    expect(indexOf("STEP I:")).toBeLessThan(indexOf("STEP J:"));
    expect(indexOf("STEP J:")).toBeLessThan(indexOf("STEP K:"));
  });
});
