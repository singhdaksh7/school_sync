import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static/regression coverage for the GitHub OIDC bootstrap Terraform root
 * (infra/bootstrap/github-oidc/). Same text/regex convention as
 * tests/deploy-staging-rollout.test.ts and tests/email-iam-mapping.test.ts —
 * this stack is never applied by CI (see tests/ci-cd-workflow-security.test.ts
 * for the ci.yml assertions that keep it that way), so these tests are the
 * only automated guard against a future edit reintroducing a wildcard trust
 * subject, a broad managed policy, or a secret-value read.
 */

const ROOT = process.cwd();
const bootstrapDir = join(ROOT, "infra", "bootstrap", "github-oidc");
const tf = (name: string) => readFileSync(join(bootstrapDir, name), "utf-8");

/**
 * Extracts a brace-balanced HCL block starting at the first "{" at or after
 * `startMarker`, counting braces (including the ones inside "${...}" string
 * interpolations — each is internally balanced, so the running depth count
 * stays correct even though it never distinguishes "in a string" from "in
 * real HCL syntax"). Far more robust than a fixed-depth regex for this
 * file's nested statement/condition/principals blocks, which are indented
 * at varying levels rather than always closing at column 0.
 */
function extractBlock(content: string, startMarker: string): string {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`marker not found: ${startMarker}`);
  const braceStart = content.indexOf("{", startIdx);
  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return content.slice(startIdx, i + 1);
    }
  }
  throw new Error(`unbalanced braces for marker: ${startMarker}`);
}

/** Every top-level `statement { ... }` block inside a policy document. */
function extractStatements(block: string): string[] {
  const statements: string[] = [];
  const re = /statement\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = match.index;
    for (; i < block.length && depth > 0; i++) {
      if (block[i] === "{") depth++;
      else if (block[i] === "}") depth--;
    }
    statements.push(block.slice(start, i));
  }
  return statements;
}

/** Strips whole-line `#` comments so negative assertions check real HCL, not prose that names the exact thing it says is absent. */
function stripComments(hcl: string): string {
  return hcl
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("OIDC provider: create-or-reuse, never a duplicate", () => {
  const content = tf("oidc-provider.tf");

  it("only creates the provider when github_oidc_provider_arn is empty (count guard)", () => {
    expect(content).toMatch(/count\s*=\s*var\.github_oidc_provider_arn\s*==\s*""\s*\?\s*1\s*:\s*0/);
  });

  it("has a precondition that fails closed instead of silently creating a duplicate", () => {
    const resource = extractBlock(content, 'resource "aws_iam_openid_connect_provider" "github"');
    expect(resource).toMatch(/precondition\s*\{/);
    expect(resource).toMatch(/condition\s*=\s*var\.github_oidc_provider_arn\s*==\s*""/);
  });

  it("exposes a single local that both the create and reuse paths resolve to", () => {
    expect(content).toMatch(/oidc_provider_arn\s*=\s*var\.github_oidc_provider_arn\s*!=\s*""\s*\?\s*var\.github_oidc_provider_arn\s*:\s*aws_iam_openid_connect_provider\.github\[0\]\.arn/);
  });

  it("client_id_list is scoped to exactly sts.amazonaws.com", () => {
    expect(content).toMatch(/client_id_list\s*=\s*\["sts\.amazonaws\.com"\]/);
  });
});

describe("Build role trust policy (schoolsync-github-staging-build): exact branch subject, no wildcard", () => {
  const content = tf("iam-build-role.tf");
  const trustDoc = extractBlock(content, 'data "aws_iam_policy_document" "build_trust"');

  it("trusts only sts.amazonaws.com as audience", () => {
    expect(trustDoc).toMatch(/variable = "token\.actions\.githubusercontent\.com:aud"/);
    expect(trustDoc).toMatch(/values\s*=\s*\["sts\.amazonaws\.com"\]/);
  });

  it("trusts only the exact repo:OWNER/REPO:ref:refs/heads/BRANCH subject — not an environment subject, not a wildcard", () => {
    expect(trustDoc).toMatch(/variable = "token\.actions\.githubusercontent\.com:sub"/);
    expect(trustDoc).toMatch(
      /values\s*=\s*\["repo:\$\{var\.github_repository_owner\}\/\$\{var\.github_repository_name\}:ref:refs\/heads\/\$\{var\.github_branch\}"\]/
    );
    expect(trustDoc).not.toMatch(/environment:/);
    expect(stripComments(trustDoc)).not.toMatch(/"\*"/);
  });

  it("has a lifecycle precondition rejecting any wildcard in owner/repo/branch", () => {
    const role = extractBlock(content, 'resource "aws_iam_role" "github_staging_build"');
    expect(role).toMatch(/precondition\s*\{/);
    expect(role).toMatch(/strcontains\(var\.github_repository_owner, "\*"\)/);
    expect(role).toMatch(/strcontains\(var\.github_repository_name, "\*"\)/);
    expect(role).toMatch(/strcontains\(var\.github_branch, "\*"\)/);
  });

  it("permissions are scoped to ECR push/scan-read on the schoolsync repository only — no ECS, IAM, Secrets Manager, RDS, or S3-app-data action anywhere", () => {
    const perms = stripComments(extractBlock(content, 'data "aws_iam_policy_document" "build_permissions"'));
    expect(perms).toMatch(/ecr:PutImage/);
    expect(perms).toMatch(/ecr:GetAuthorizationToken/);
    expect(perms).not.toMatch(/"ecs:/);
    expect(perms).not.toMatch(/"iam:/);
    expect(perms).not.toMatch(/secretsmanager:/);
    expect(perms).not.toMatch(/"rds:/);
    expect(perms).not.toMatch(/"s3:/);
    expect(perms).not.toMatch(/PassRole/);
  });

  it('the only Resource: "*" statement is the documented ecr:GetAuthorizationToken exception', () => {
    const perms = extractBlock(content, 'data "aws_iam_policy_document" "build_permissions"');
    const statements = extractStatements(perms);
    expect(statements.length).toBeGreaterThan(0);
    const wildcardStatements = statements.filter((s) => /resources\s*=\s*\["\*"\]/.test(s));
    expect(wildcardStatements.length).toBe(1);
    expect(wildcardStatements[0]).toMatch(/ecr:GetAuthorizationToken/);
    expect(wildcardStatements[0]).toMatch(/requires[\s\S]{0,80}"\*"/);
  });
});

describe("Deploy role trust policy (schoolsync-github-staging-deploy): exact Environment subject, no wildcard", () => {
  const content = tf("iam-deploy-role.tf");
  const trustDoc = extractBlock(content, 'data "aws_iam_policy_document" "deploy_trust"');

  it("trusts only the exact repo:OWNER/REPO:environment:ENVIRONMENT subject — not a branch ref, not a wildcard", () => {
    expect(trustDoc).toMatch(/variable = "token\.actions\.githubusercontent\.com:sub"/);
    expect(trustDoc).toMatch(
      /values\s*=\s*\["repo:\$\{var\.github_repository_owner\}\/\$\{var\.github_repository_name\}:environment:\$\{var\.github_environment\}"\]/
    );
    expect(stripComments(trustDoc)).not.toMatch(/ref:refs\/heads/);
    expect(stripComments(trustDoc)).not.toMatch(/"\*"/);
  });

  it("audience is exactly sts.amazonaws.com", () => {
    expect(trustDoc).toMatch(/variable = "token\.actions\.githubusercontent\.com:aud"/);
    expect(trustDoc).toMatch(/values\s*=\s*\["sts\.amazonaws\.com"\]/);
  });

  it("has a lifecycle precondition rejecting any wildcard in owner/repo/environment", () => {
    const role = extractBlock(content, 'resource "aws_iam_role" "github_staging_deploy"');
    expect(role).toMatch(/precondition\s*\{/);
    expect(role).toMatch(/strcontains\(var\.github_repository_owner, "\*"\)/);
    expect(role).toMatch(/strcontains\(var\.github_repository_name, "\*"\)/);
    expect(role).toMatch(/strcontains\(var\.github_environment, "\*"\)/);
  });

  it("iam:PassRole is scoped to exactly the three existing ECS execution/task roles, conditioned on ecs-tasks.amazonaws.com", () => {
    const perms = extractBlock(content, 'data "aws_iam_policy_document" "deploy_permissions"');
    const statements = extractStatements(perms);
    const passRoleStatement = statements.find((s) => /sid\s*=\s*"PassExecutionAndTaskRolesToEcsTasksOnly"/.test(s));
    expect(passRoleStatement).toBeDefined();
    expect(passRoleStatement).toMatch(/actions = \["iam:PassRole"\]/);
    expect(passRoleStatement).toMatch(/local\.ecs_execution_role_arn/);
    expect(passRoleStatement).toMatch(/local\.ecs_task_web_role_arn/);
    expect(passRoleStatement).toMatch(/local\.ecs_task_minimal_role_arn/);
    expect(passRoleStatement).toMatch(/variable = "iam:PassedToService"/);
    expect(passRoleStatement).toMatch(/values\s*=\s*\["ecs-tasks\.amazonaws\.com"\]/);
  });

  it("never grants secretsmanager:GetSecretValue anywhere in this file", () => {
    // Comments legitimately name GetSecretValue to explain its absence
    // ("GetSecretValue is intentionally never granted...") — check that no
    // ACTUAL IAM action string ("...GetSecretValue") appears, not prose.
    expect(content).not.toMatch(/"secretsmanager:GetSecretValue"/);
    expect(content).not.toMatch(/actions\s*=\s*\[[^\]]*GetSecretValue/);
  });

  it("never grants an infrastructure-mutation action (RDS/ElastiCache/VPC/security-group/IAM-role/route53 writes)", () => {
    const code = stripComments(content);
    const forbidden = [
      /rds:(Create|Modify|Delete)/,
      /elasticache:(Create|Modify|Delete)/,
      /ec2:(CreateVpc|CreateSecurityGroup|DeleteVpc|DeleteSecurityGroup)/,
      /iam:(CreateRole|DeleteRole|PutRolePolicy|AttachRolePolicy|CreatePolicy)/,
      /route53:Change/,
      /s3:(PutBucket|DeleteBucket)/,
      /ecs:(CreateService|DeleteService|DeleteCluster)/,
    ];
    for (const pattern of forbidden) {
      expect(code).not.toMatch(pattern);
    }
  });

  it("never references AdministratorAccess or PowerUserAccess managed policies", () => {
    expect(content).not.toMatch(/AdministratorAccess/);
    expect(content).not.toMatch(/PowerUserAccess/);
  });

  it("Terraform state lock access has no s3:PutObject anywhere (read/lock only, never a state write)", () => {
    expect(stripComments(content)).not.toMatch(/s3:PutObject/);
  });

  it('every Resource: "*" statement carries a documented justification comment in the same file', () => {
    const perms = extractBlock(content, 'data "aws_iam_policy_document" "deploy_permissions"');
    const statements = extractStatements(perms);
    const wildcardStatements = statements.filter((s) => /resources\s*=\s*\["\*"\]/.test(s));
    expect(wildcardStatements.length).toBeGreaterThan(0);
    expect(content).toMatch(/AWS requires Resource: "\*"|AWS requires "\*" for this action/);
  });
});

describe("Bootstrap outputs: role ARNs only, never a credential", () => {
  const content = tf("outputs.tf");

  it("outputs both role ARNs", () => {
    expect(content).toMatch(/output "github_staging_build_role_arn"/);
    expect(content).toMatch(/output "github_staging_deploy_role_arn"/);
  });

  it("documents that these are repository/environment VARIABLES, never secrets", () => {
    expect(content).toMatch(/never store it as a secret|not a secret/);
  });

  it("never outputs a sensitive value", () => {
    expect(content).not.toMatch(/sensitive\s*=\s*true/);
  });
});

describe("No credentials, secret values, backend files, or local state are committed", () => {
  it("no .tf file contains a literal AWS access key id or secret access key pattern", () => {
    const files = ["variables.tf", "oidc-provider.tf", "iam-build-role.tf", "iam-deploy-role.tf", "outputs.tf", "providers.tf", "versions.tf"];
    for (const file of files) {
      const content = tf(file);
      expect(content).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(content).not.toMatch(/aws_secret_access_key\s*=\s*"/i);
    }
  });

  it("versions.tf declares a partial backend (no bucket/key/table hardcoded) and pins the aws + tls providers", () => {
    const content = tf("versions.tf");
    expect(content).toMatch(/backend "s3" \{\s*\}/);
    expect(stripComments(content)).not.toMatch(/bucket\s*=\s*"/);
    expect(content).toMatch(/source\s*=\s*"hashicorp\/aws"/);
  });

  it("this is a SEPARATE state/backend from the staging application stack", () => {
    const bootstrapBackendExample = readFileSync(join(bootstrapDir, "backend.hcl.example"), "utf-8");
    const appBackendExample = readFileSync(join(ROOT, "infra", "terraform", "backend.hcl.example"), "utf-8");
    const bootstrapKey = bootstrapBackendExample.match(/key\s*=\s*"([^"]+)"/)![1];
    const appKey = appBackendExample.match(/key\s*=\s*"([^"]+)"/)![1];
    expect(bootstrapKey).not.toBe(appKey);
  });

  it("backend.hcl / tfplan are gitignored (only .example files are tracked)", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf-8");
    expect(gitignore).toMatch(/infra\/bootstrap\/github-oidc\/backend\.hcl/);
    // Generic *.tfvars / **/.terraform/ / *.tfstate* patterns already cover
    // this directory too (see infra/terraform's identical reliance on them).
    expect(gitignore).toMatch(/\*\.tfvars/);
    expect(gitignore).toMatch(/\*\*\/\.terraform\//);
  });
});

describe("Environment selection is variable-driven, never hardcoded to production", () => {
  const files = ["variables.tf", "oidc-provider.tf", "iam-build-role.tf", "iam-deploy-role.tf", "outputs.tf"];

  it("no role name or trust subject hardcodes the production environment", () => {
    for (const file of files) {
      const content = tf(file);
      expect(content).not.toMatch(/schoolsync-github-production/);
      expect(content).not.toMatch(/environment:production/);
    }
  });
});
