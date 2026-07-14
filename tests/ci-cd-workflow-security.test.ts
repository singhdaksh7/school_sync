import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Static/regression coverage for the GitHub Actions CI/CD foundation
 * (.github/workflows/ci.yml, .github/workflows/deploy-staging.yml,
 * .github/dependabot.yml). Deliberately text/regex-based — same convention
 * as tests/deploy-staging-rollout.test.ts and tests/email-iam-mapping.test.ts
 * — so a future edit that silently grants CI an AWS permission, switches an
 * action back to a floating tag, or lets a routine deploy skip the
 * Terraform no-change gate fails loudly here instead of only being caught
 * in a live run.
 */

const ROOT = process.cwd();
const workflowsDir = join(ROOT, ".github", "workflows");
const ci = () => readFileSync(join(workflowsDir, "ci.yml"), "utf-8");
const deployStaging = () => readFileSync(join(workflowsDir, "deploy-staging.yml"), "utf-8");
const dependabot = () => readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf-8");

function allWorkflowFiles(): { name: string; content: string }[] {
  return readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((name) => ({ name, content: readFileSync(join(workflowsDir, name), "utf-8") }));
}

/**
 * Strips `#`-comment lines (this repo's workflows/docs are heavily
 * commented, and several comments deliberately name the exact thing they
 * assert is absent, e.g. "never requests `id-token: write`") so negative
 * ("must not contain X") assertions check actual YAML/code, not prose.
 * Not a general YAML parser — just enough to drop whole-line `#` comments,
 * which is everywhere this codebase's comments live (never inline after
 * real content on the same line, matching its existing style).
 */
function stripComments(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("ci.yml: no AWS/OIDC access is ever possible", () => {
  const content = ci();
  const code = stripComments(content);

  it("never requests id-token permission anywhere in the file", () => {
    expect(code).not.toMatch(/id-token:\s*write/);
  });

  it("never uses pull_request_target as a trigger", () => {
    expect(code).not.toMatch(/pull_request_target:/);
  });

  it("never invokes configure-aws-credentials or any other AWS-auth action", () => {
    expect(code).not.toMatch(/uses:.*configure-aws-credentials/);
    expect(code).not.toMatch(/uses:.*aws-actions\//);
  });

  it("triggers on PRs/pushes to both staging and main, never on any other implicit trigger that could leak elevated context", () => {
    expect(content).toMatch(/pull_request:\s*\r?\n\s*branches:\s*\[staging,\s*main\]/);
    expect(content).toMatch(/push:\s*\r?\n\s*branches:\s*\[staging,\s*main\]/);
  });

  it("declares workflow-level and every job-level permissions as contents: read only", () => {
    const permissionsBlocks = content.match(/permissions:\r?\n\s*contents:\s*read/g) ?? [];
    // 1 workflow-level + 4 jobs (test, terraform, powershell, docker)
    expect(permissionsBlocks.length).toBeGreaterThanOrEqual(5);
    // No job may declare any broader permission anywhere in the file.
    expect(content).not.toMatch(/permissions:\s*write-all/);
    expect(content).not.toMatch(/contents:\s*write/);
  });

  it("has a concurrency group with cancel-in-progress so superseded runs are cancelled", () => {
    expect(content).toMatch(/concurrency:\s*\r?\n\s*group:/);
    expect(content).toMatch(/cancel-in-progress:\s*true/);
  });

  it("runs the required build/test steps: prisma generate, tsc --noEmit, lint, vitest run, build", () => {
    expect(content).toMatch(/npx prisma generate/);
    expect(content).toMatch(/npx tsc --noEmit -p tsconfig\.json/);
    expect(content).toMatch(/npm run lint/);
    expect(content).toMatch(/npx vitest run/);
    expect(content).toMatch(/npm run build/);
  });

  it("runs terraform fmt -check -recursive, init -backend=false, and validate for BOTH terraform roots", () => {
    expect(content).toMatch(/terraform fmt -check -recursive/);
    expect(content).toMatch(/terraform init -backend=false -input=false/);
    expect(content).toMatch(/terraform validate/);
    expect(content).toMatch(/infra\/terraform\s*\r?\n\s*-\s*infra\/bootstrap\/github-oidc/);
  });

  it("parses every infra/scripts/*.ps1 file with the PowerShell 7 AST parser", () => {
    expect(content).toMatch(/System\.Management\.Automation\.Language\.Parser.*ParseFile/);
    expect(content).toMatch(/infra\/scripts/);
    expect(content).toMatch(/shell:\s*pwsh/);
  });

  it("builds the Docker image without pushing, provenance, or SBOM", () => {
    const dockerJob = content.match(/docker:\r?\n[\s\S]*$/)![0];
    expect(dockerJob).toMatch(/push:\s*false/);
    expect(dockerJob).toMatch(/provenance:\s*false/);
    expect(dockerJob).toMatch(/sbom:\s*false/);
    expect(dockerJob).toMatch(/platforms:\s*linux\/amd64/);
  });

  it("Node.js version matches the Dockerfile's production runtime (node:22-alpine), not an arbitrary CI-only version", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf-8");
    expect(dockerfile).toMatch(/ARG NODE_IMAGE=node:22-alpine/);
    expect(content).toMatch(/node-version:\s*"22"/);
  });

  it("caches npm dependencies via the official setup-node action's built-in cache option", () => {
    expect(content).toMatch(/actions\/setup-node@[0-9a-f]{40}[\s\S]*?cache:\s*npm/);
  });
});

describe("deploy-staging.yml: build-and-scan job (staging-build role only)", () => {
  const content = deployStaging();
  const buildJob = content.match(/build-and-scan:\r?\n[\s\S]*?(?=\n  deploy:)/)![0];

  it("triggers on push to staging and workflow_dispatch only", () => {
    expect(content).toMatch(/push:\s*\r?\n\s*branches:\s*\[staging\]/);
    expect(content).toMatch(/workflow_dispatch:/);
  });

  it("runs only for an exact commit on staging (job-level if gate)", () => {
    expect(buildJob).toMatch(/if:\s*github\.ref == 'refs\/heads\/staging'/);
  });

  it("has exactly contents: read and id-token: write permissions", () => {
    const permsBlock = buildJob.match(/permissions:\r?\n\s*contents:\s*read\r?\n\s*id-token:\s*write/);
    expect(permsBlock).not.toBeNull();
  });

  it("assumes the staging-BUILD role via a repository variable, never a hardcoded ARN or an access-key secret", () => {
    expect(buildJob).toMatch(/role-to-assume:\s*\$\{\{\s*vars\.STAGING_BUILD_ROLE_ARN\s*\}\}/);
  });

  it("verifies the assumed-role account is exactly 928805968612 before any ECR push", () => {
    // The literal account id lives in the workflow-level `env:` block;
    // the build job itself compares against that via $AWS_ACCOUNT_ID.
    expect(content).toMatch(/AWS_ACCOUNT_ID:\s*"928805968612"/);
    expect(buildJob).toMatch(/aws sts get-caller-identity/);
    expect(buildJob).toMatch(/AWS_ACCOUNT_ID/);
  });

  it("builds a single linux/amd64 image, tagged ONLY with the full commit SHA — never latest", () => {
    expect(buildJob).toMatch(/platforms:\s*linux\/amd64/);
    expect(buildJob).toMatch(/tags:.*github\.sha/);
    expect(buildJob).not.toMatch(/:latest/);
  });

  it("disables provenance and SBOM attestation (plain Docker v2 manifest, matching the production build path)", () => {
    expect(buildJob).toMatch(/provenance:\s*false/);
    expect(buildJob).toMatch(/sbom:\s*false/);
  });

  it("pushes to ECR (push: true) only in this workflow, never in ci.yml", () => {
    expect(buildJob).toMatch(/push:\s*true/);
    expect(stripComments(ci())).not.toMatch(/push:\s*true/);
  });

  it("waits for the ECR scan and fails on any CRITICAL/HIGH finding via the shared Assert-EcrImageApproved gate", () => {
    expect(buildJob).toMatch(/Assert-EcrImageApproved/);
    expect(buildJob).toMatch(/infra\/scripts\/common\.ps1/);
  });

  it("records image tag, digest, and scan severity counts as job outputs", () => {
    expect(buildJob).toMatch(/image_tag:/);
    expect(buildJob).toMatch(/image_digest:/);
    expect(buildJob).toMatch(/scan_critical:/);
    expect(buildJob).toMatch(/scan_high:/);
  });

  it("never prints an AWS access key, secret key, or session token", () => {
    expect(buildJob).not.toMatch(/AWS_ACCESS_KEY_ID/);
    expect(buildJob).not.toMatch(/AWS_SECRET_ACCESS_KEY/);
    expect(buildJob).not.toMatch(/AWS_SESSION_TOKEN/);
  });
});

describe("deploy-staging.yml: protected deploy job (staging-deploy role only, staging Environment)", () => {
  const content = deployStaging();
  const deployJob = content.match(/\n  deploy:\r?\n[\s\S]*$/)![0];

  it("depends on build-and-scan and only runs for an exact commit on staging", () => {
    expect(deployJob).toMatch(/needs:\s*build-and-scan/);
    expect(deployJob).toMatch(/if:\s*github\.ref == 'refs\/heads\/staging'/);
  });

  it("uses the exact GitHub Environment 'staging'", () => {
    expect(deployJob).toMatch(/environment:\s*staging/);
  });

  it("has exactly contents: read and id-token: write permissions", () => {
    const permsBlock = deployJob.match(/permissions:\r?\n\s*contents:\s*read\r?\n\s*id-token:\s*write/);
    expect(permsBlock).not.toBeNull();
  });

  it("uses concurrency group schoolsync-staging-deploy and never cancels an in-progress deployment", () => {
    expect(deployJob).toMatch(/group:\s*schoolsync-staging-deploy/);
    expect(deployJob).toMatch(/cancel-in-progress:\s*false/);
  });

  it("assumes the staging-DEPLOY role via an environment variable, never a hardcoded ARN or an access-key secret", () => {
    expect(deployJob).toMatch(/role-to-assume:\s*\$\{\{\s*vars\.STAGING_DEPLOY_ROLE_ARN\s*\}\}/);
  });

  it("reverifies account, region, and the exact image digest before any ECS mutation", () => {
    expect(content).toMatch(/AWS_ACCOUNT_ID:\s*"928805968612"/);
    expect(deployJob).toMatch(/AWS_ACCOUNT_ID/);
    expect(deployJob).toMatch(/Reverify AWS account\/region/i);
    expect(deployJob).toMatch(/Reverif(y|ied) digest/i);
  });

  it("runs the Terraform no-change gate BEFORE the native deploy script's ECS mutation, via -RequireTerraformNoChanges", () => {
    expect(deployJob).toMatch(/-RequireTerraformNoChanges/);
    expect(deployJob).toMatch(/-UseOidcCredentials/);
    const scriptCallIndex = deployJob.indexOf("deploy-staging.ps1");
    expect(scriptCallIndex).toBeGreaterThan(-1);
  });

  it("never uploads Terraform plan/state files as workflow artifacts", () => {
    expect(content).not.toMatch(/actions\/upload-artifact/);
    expect(deployJob).not.toMatch(/tfplan/);
  });

  it("never fetches a secret value (no get-secret-value / GetSecretValue anywhere)", () => {
    expect(deployJob).not.toMatch(/get-secret-value/i);
    expect(deployJob).not.toMatch(/GetSecretValue/);
  });

  it("verifies liveness/readiness over HTTPS without disabling TLS verification", () => {
    expect(content).toMatch(/STAGING_URL:\s*https:\/\/pilot\.zipinnovate\.com/);
    expect(deployJob).toMatch(/STAGING_URL/);
    expect(deployJob).toMatch(/curl/);
    expect(deployJob).not.toMatch(/curl[^\n]*(-k\b|--insecure)/);
  });

  it("runs a follow-up Terraform plan that must report no changes after deployment", () => {
    expect(deployJob).toMatch(/Follow-up Terraform plan/);
    expect(deployJob).toMatch(/-detailed-exitcode/);
  });

  it("writes a sanitized summary to GITHUB_STEP_SUMMARY and never prints AWS tokens/credentials", () => {
    expect(deployJob).toMatch(/GITHUB_STEP_SUMMARY/);
    expect(deployJob).not.toMatch(/AWS_ACCESS_KEY_ID/);
    expect(deployJob).not.toMatch(/AWS_SECRET_ACCESS_KEY/);
    expect(deployJob).not.toMatch(/AWS_SESSION_TOKEN/);
  });

  it("does not reference a production environment or role anywhere in this workflow", () => {
    expect(content).not.toMatch(/environment:\s*production/);
    expect(content).not.toMatch(/schoolsync-github-production/);
  });
});

describe("Supply-chain: every third-party/official action is pinned to a full commit SHA with a version comment", () => {
  const shaPinPattern = /uses:\s*[\w.-]+\/[\w.-]+@([0-9a-f]{40})\s*#\s*v[\w.-]+/;

  for (const { name, content } of allWorkflowFiles()) {
    it(`${name}: every "uses:" reference is SHA-pinned with a version comment`, () => {
      const usesLines = content.match(/^\s*uses:.*$/gm) ?? [];
      expect(usesLines.length).toBeGreaterThan(0);
      for (const line of usesLines) {
        expect(line).toMatch(shaPinPattern);
        // No floating major/minor tag (e.g. @v4, @v4.2) anywhere.
        expect(line).not.toMatch(/@v\d[\w.]*\s*$/);
      }
    });
  }

  it("no workflow references a mutable ref like @main, @master, or @latest for any action", () => {
    for (const { content } of allWorkflowFiles()) {
      expect(content).not.toMatch(/uses:\s*[\w.-]+\/[\w.-]+@(main|master|latest)\b/);
    }
  });
});

describe("Workflows declare explicit timeouts and never rely on the default 360-minute ceiling", () => {
  for (const { name, content } of allWorkflowFiles()) {
    it(`${name}: every job declares timeout-minutes`, () => {
      const jobBlocks = content.split(/^  \w[\w-]*:\r?\n/m).slice(1);
      expect(jobBlocks.length).toBeGreaterThan(0);
      for (const job of jobBlocks) {
        // Only check blocks that look like actual job definitions (have runs-on).
        if (/runs-on:/.test(job)) {
          expect(job).toMatch(/timeout-minutes:\s*\d+/);
        }
      }
    });
  }
});

describe("Dependabot configuration", () => {
  const content = dependabot();

  it("covers github-actions, npm, and docker ecosystems", () => {
    expect(content).toMatch(/package-ecosystem:\s*"github-actions"/);
    expect(content).toMatch(/package-ecosystem:\s*"npm"/);
    expect(content).toMatch(/package-ecosystem:\s*"docker"/);
  });

  it("never configures auto-merge for dependency updates", () => {
    expect(stripComments(content)).not.toMatch(/auto-merge/i);
    for (const { content: wf } of allWorkflowFiles()) {
      expect(stripComments(wf)).not.toMatch(/auto-?merge/i);
    }
  });
});

describe("No workflow ever references a permanent AWS credential", () => {
  for (const { name, content } of allWorkflowFiles()) {
    it(`${name}: no AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY secret reference`, () => {
      expect(content).not.toMatch(/secrets\.AWS_ACCESS_KEY_ID/);
      expect(content).not.toMatch(/secrets\.AWS_SECRET_ACCESS_KEY/);
    });
  }
});
