import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Regression coverage for the first GitHub OIDC staging deployment failure:
 * deploy-staging.ps1's STEP A preflight invocation built
 * `@("-ExpectedAccountId", $ExpectedAccountId, "-ImageTag", $ImageTag)` — a
 * plain array — and splatted it with `@preflightArgs`. Array splatting binds
 * PURELY POSITIONALLY: PowerShell never re-parses a splatted array's string
 * elements as "-ParamName" tokens, so the literal string "-ExpectedAccountId"
 * itself bound to preflight.ps1's first positional parameter
 * ($ExpectedAccountId), the real account id shifted into $ImageTag, and the
 * literal "-ImageTag" string plus the real tag plus "-UseOidcCredentials"
 * (when present) all fell, unbound, into preflight.ps1's own $args — never
 * reaching $UseOidcCredentials at all. This reproduced exactly what was
 * observed in CI: `authenticated=928805968612, expected=-ExpectedAccountId`
 * and "-ImageTag not supplied".
 *
 * These tests execute the REAL extracted invocation source from
 * deploy-staging.ps1 (not a hand-written reimplementation) against a stub
 * preflight.ps1 that reports exactly how it was bound — proving the actual
 * PowerShell parameter-binding boundary, matching the convention in
 * tests/deploy-staging-migrate-family-resolution.test.ts and
 * tests/deploy-staging-arn-stream-pollution.test.ts (no Pester dependency).
 * \r?\n / explicit CRLF-and-LF variants tolerate either checkout.
 */

const ROOT = process.cwd();
const scriptsDir = join(ROOT, "infra", "scripts");
const deployStaging = () => readFileSync(join(scriptsDir, "deploy-staging.ps1"), "utf-8");

// The pre-fix array-splat pattern this regression test guards against —
// reconstructed verbatim from the failing commit so this suite would have
// caught it, and continues to document the exact footgun (a flat array of
// alternating "-ParamName"/value strings, splatted with @).
const PRE_FIX_BUGGY_SOURCE = [
  "if (-not $SkipPreflight) {",
  '    Write-Step "STEP A: Running AWS prerequisite preflight"',
  '    $preflightArgs = @("-ExpectedAccountId", $ExpectedAccountId, "-ImageTag", $ImageTag)',
  '    if ($UseOidcCredentials) { $preflightArgs += "-UseOidcCredentials" }',
  '    & (Join-Path $PSScriptRoot "preflight.ps1") @preflightArgs',
  "    if ($LASTEXITCODE -ne 0) {",
  '        Write-Fail "Preflight failed"',
  "        exit 1",
  "    }",
  "}",
].join("\n");

function extractFixedPreflightInvocationBlock(content: string): string {
  const match = content.match(
    /(if \(-not \$SkipPreflight\) \{[\s\S]*?\r?\n\})\r?\n\r?\nif \(\$RequireTerraformNoChanges\)/,
  );
  expect(match, "expected to find the STEP A preflight-invocation if-block in deploy-staging.ps1").not.toBeNull();
  return match![1];
}

function bothLineEndings(content: string): { crlf: string; lf: string } {
  const lf = content.replace(/\r\n/g, "\n");
  return { crlf: lf.replace(/\n/g, "\r\n"), lf };
}

interface PreflightBinding {
  ExpectedAccountId: string;
  ImageTag: string;
  UseOidcCredentials: boolean;
  BoundKeys: string[];
}

// Runs `blockSource` (the real, or reconstructed pre-fix, STEP A invocation
// text) inside a harness that supplies the same local variables
// deploy-staging.ps1 has in scope at that point, against a stub
// preflight.ps1 (dropped in the harness's own directory, so the block's own
// `Join-Path $PSScriptRoot "preflight.ps1"` resolves to it via PowerShell's
// automatic $PSScriptRoot — no AWS call is ever made) that reports exactly
// how it received its parameters instead of doing anything real.
function runPreflightInvocation(
  blockSource: string,
  opts: { imageTag: string; useOidc: boolean },
): PreflightBinding {
  const dir = mkdtempSync(join(tmpdir(), "preflight-splat-test-"));
  try {
    writeFileSync(
      join(dir, "preflight.ps1"),
      [
        "param(",
        '    [string]$ExpectedAccountId = "",',
        '    [string]$ImageTag = "",',
        "    [switch]$UseOidcCredentials",
        ")",
        "$result = [ordered]@{",
        "    ExpectedAccountId = $ExpectedAccountId",
        "    ImageTag = $ImageTag",
        "    UseOidcCredentials = [bool]$UseOidcCredentials",
        "    BoundKeys = @($PSBoundParameters.Keys)",
        "}",
        "$result | ConvertTo-Json -Compress",
        "exit 0",
        "",
      ].join("\n"),
    );

    const harnessPath = join(dir, "harness.ps1");
    writeFileSync(
      harnessPath,
      [
        "function Write-Step { param([string]$Message) }",
        "function Write-Fail { param([string]$Message) }",
        "$SkipPreflight = $false",
        '$ExpectedAccountId = "928805968612"',
        `$ImageTag = "${opts.imageTag}"`,
        `$UseOidcCredentials = ${opts.useOidc ? "$true" : "$false"}`,
        blockSource,
        "",
      ].join("\n"),
    );

    const stdout = execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", harnessPath], {
      encoding: "utf-8",
    });
    return JSON.parse(stdout.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("deploy-staging.ps1 STEP A: preflight parameter forwarding uses hashtable splatting, not array splatting", () => {
  it("the invocation splats a hashtable (@{...}), not a flat array of alternating -ParamName/value strings", () => {
    const block = extractFixedPreflightInvocationBlock(deployStaging());
    expect(block).toMatch(/\$preflightParams\s*=\s*@\{/);
    expect(block).toMatch(/&\s*\(Join-Path \$PSScriptRoot "preflight\.ps1"\)\s*@preflightParams/);
    expect(block).not.toMatch(/@\(\s*"-ExpectedAccountId"/);
  });

  it("ExpectedAccountId resolves to the real account id (928805968612), never the literal parameter name", () => {
    const block = extractFixedPreflightInvocationBlock(deployStaging());
    const bound = runPreflightInvocation(block, { imageTag: "2026-07-14-abc1234", useOidc: false });
    expect(bound.ExpectedAccountId).toBe("928805968612");
    expect(bound.ExpectedAccountId).not.toBe("-ExpectedAccountId");
  });

  it("ImageTag is received exactly, never the shifted account-id value", () => {
    const block = extractFixedPreflightInvocationBlock(deployStaging());
    const bound = runPreflightInvocation(block, { imageTag: "2026-07-14-abc1234", useOidc: false });
    expect(bound.ImageTag).toBe("2026-07-14-abc1234");
  });

  it("UseOidcCredentials binds true when the switch is set, and the key is present in $PSBoundParameters", () => {
    const block = extractFixedPreflightInvocationBlock(deployStaging());
    const bound = runPreflightInvocation(block, { imageTag: "2026-07-14-abc1234", useOidc: true });
    expect(bound.UseOidcCredentials).toBe(true);
    expect(bound.BoundKeys).toContain("UseOidcCredentials");
  });

  it("UseOidcCredentials is omitted (not forced false) when the switch is not set, matching non-OIDC local usage", () => {
    const block = extractFixedPreflightInvocationBlock(deployStaging());
    const bound = runPreflightInvocation(block, { imageTag: "2026-07-14-abc1234", useOidc: false });
    expect(bound.UseOidcCredentials).toBe(false);
    expect(bound.BoundKeys).not.toContain("UseOidcCredentials");
  });

  it("binds correctly under both a CRLF and an LF checkout of deploy-staging.ps1", () => {
    const raw = extractFixedPreflightInvocationBlock(deployStaging());
    const { crlf, lf } = bothLineEndings(raw);
    for (const [label, variant] of [
      ["CRLF", crlf],
      ["LF", lf],
    ] as const) {
      const bound = runPreflightInvocation(variant, { imageTag: "2026-07-14-abc1234", useOidc: true });
      expect(bound.ExpectedAccountId, label).toBe("928805968612");
      expect(bound.ImageTag, label).toBe("2026-07-14-abc1234");
      expect(bound.UseOidcCredentials, label).toBe(true);
    }
  });
});

describe("deploy-staging.ps1 STEP A: this suite would have caught the original array-splat bug", () => {
  it("the reconstructed pre-fix array-splat pattern reproduces the exact observed CI failure", () => {
    const bound = runPreflightInvocation(PRE_FIX_BUGGY_SOURCE, { imageTag: "2026-07-14-abc1234", useOidc: true });
    // The literal parameter name, not the real account id — exactly the
    // "expected=-ExpectedAccountId" reported by the real preflight run.
    expect(bound.ExpectedAccountId).toBe("-ExpectedAccountId");
    // The real account id shifted into the wrong parameter.
    expect(bound.ImageTag).toBe("928805968612");
    // "-ImageTag", the real tag, and "-UseOidcCredentials" all fall unbound
    // into $args and never reach the switch.
    expect(bound.UseOidcCredentials).toBe(false);
    expect(bound.BoundKeys).not.toContain("UseOidcCredentials");
  });
});
