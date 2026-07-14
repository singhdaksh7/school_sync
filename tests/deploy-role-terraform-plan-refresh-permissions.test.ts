import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the second GitHub OIDC staging deploy failure:
 * after the HeadBucket/DescribeTable backend-permissions fix
 * (tests/deploy-role-terraform-backend-permissions.test.ts), STEP A's
 * `-RequireTerraformNoChanges` gate ran a real `terraform plan` against the
 * application stack and failed with AccessDenied on seven read-only actions
 * the current AWS provider needs to refresh existing resources (confirmed
 * from the full failed-run log, workflow run 29362009940 — the log was
 * re-audited in full, not just a truncated preview, surfacing a 5th
 * CloudWatch alarm and the ServiceDiscovery action that a first pass missed):
 *
 * - logs:ListTagsForResource on the 3 ECS log groups (web/worker/migrate)
 * - cloudwatch:ListTagsForResource on 5 alarms (alb-unhealthy-targets,
 *   alb-5xx, rds-cpu, rds-low-storage, rds-connections)
 * - ecr:ListTagsForResource on the schoolsync repository
 * - elasticache:ListTagsForResource on the schoolsync-staging-redis subnet
 *   group
 * - s3:GetAccelerateConfiguration on the schoolsync-staging-storage-* bucket
 * - secretsmanager:GetResourcePolicy on the schoolsync-staging/app-* secret
 *   (metadata only — never accompanied by GetSecretValue)
 * - servicediscovery:ListTagsForResource on the Cloud Map private DNS
 *   namespace
 *
 * Fix: the four actions whose resource is already scoped by an existing
 * statement (ecr, logs, secretsmanager, s3) were added to that statement's
 * action list. The three with no existing statement (cloudwatch,
 * elasticache, servicediscovery) got new statements. cloudwatch and
 * elasticache are scoped to an exact ARN (or, for the 5 alarms, an exact
 * enumerated list) — never a wildcard resource, per this role's
 * exact-scoping requirement.
 *
 * servicediscovery:ListTagsForResource is the one documented exception: an
 * earlier version of this fix scoped it to the exact namespace ARN, which
 * turned out to be silently ineffective — confirmed via
 * `simulate-principal-policy` returning implicitDeny even under a
 * supplemental candidate policy granting the same action on Resource: "*"
 * (isolated against a control test on elasticache:ListTagsForResource using
 * the identical method, which correctly returned allowed). AWS's IAM
 * service authorization reference for AWS Cloud Map lists no resource type
 * for ListTagsForResource, meaning it does not support resource-level
 * scoping at all and requires Resource: "*". This is the only wildcard
 * resource permitted anywhere in this file's new/modified statements, and
 * it is isolated to a dedicated statement granting only this one action.
 *
 * Text/regex-based, matching the convention in
 * tests/deploy-role-terraform-backend-permissions.test.ts and
 * tests/github-oidc-bootstrap.test.ts (this stack is never applied by CI —
 * see tests/ci-cd-workflow-security.test.ts).
 */

const ROOT = process.cwd();
const bootstrapDir = join(ROOT, "infra", "bootstrap", "github-oidc");
const tf = (name: string) => readFileSync(join(bootstrapDir, name), "utf-8");

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

function stripComments(hcl: string): string {
  return hcl
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("Deploy role: application-stack terraform-plan refresh permissions", () => {
  const content = tf("iam-deploy-role.tf");
  const perms = extractBlock(content, 'data "aws_iam_policy_document" "deploy_permissions"');
  const statements = extractStatements(perms);
  const cleanContent = stripComments(content);

  const findSid = (sid: string) => {
    const found = statements.find((s) => new RegExp(`sid\\s*=\\s*"${sid}"`).test(s));
    expect(found, `expected to find a statement with sid "${sid}"`).toBeDefined();
    return found!;
  };

  it("ecr:ListTagsForResource is added to the existing ECR statement, same exact repository ARN, not Resource: \"*\"", () => {
    const stmt = findSid("EcrReadForDeployVerification");
    expect(stmt).toMatch(/"ecr:ListTagsForResource"/);
    expect(stmt).toMatch(/resources\s*=\s*\["arn:aws:ecr:\$\{var\.aws_region\}:\$\{var\.aws_account_id\}:repository\/\$\{var\.ecr_repository_name\}"\]/);
  });

  it("logs:ListTagsForResource is added to the existing CloudWatch Logs statement, same exact log-group pattern", () => {
    const stmt = findSid("CloudWatchLogsReadForPostDeployVerification");
    expect(stmt).toMatch(/"logs:ListTagsForResource"/);
    expect(stmt).toMatch(/resources\s*=\s*\[local\.log_group_arn_pattern\]/);
  });

  it("secretsmanager:GetResourcePolicy is added to the existing secrets-metadata statement, same exact secret pattern, and GetSecretValue is never introduced", () => {
    const stmt = findSid("TerraformPlanSecretsMetadataOnly");
    expect(stmt).toMatch(/"secretsmanager:GetResourcePolicy"/);
    expect(stmt).toMatch(/"secretsmanager:DescribeSecret"/);
    expect(stripComments(stmt)).not.toMatch(/GetSecretValue/);
    expect(stmt).toMatch(/resources\s*=\s*\[local\.secrets_manager_secret_arn_pattern\]/);
  });

  it("s3:GetAccelerateConfiguration is added to the existing S3-bucket-read statement, same exact bucket pattern", () => {
    const stmt = findSid("TerraformPlanS3BucketReadOnly");
    expect(stmt).toMatch(/"s3:GetAccelerateConfiguration"/);
    expect(stmt).toMatch(/resources\s*=\s*\[local\.app_s3_bucket_arn_pattern\]/);
  });

  it("cloudwatch:ListTagsForResource is scoped to exactly the 5 confirmed alarm ARNs, enumerated (not a wildcard resource)", () => {
    const stmt = findSid("TerraformPlanCloudWatchAlarmTagsReadOnly");
    expect(stmt).toMatch(/actions\s*=\s*\["cloudwatch:ListTagsForResource"\]/);
    expect(stmt).toMatch(/resources\s*=\s*local\.cloudwatch_alarm_arns/);

    const localsBlock = extractBlock(content, "locals {");
    const arnsMatch = localsBlock.match(/cloudwatch_alarm_arns\s*=\s*\[([\s\S]*?)\]/);
    expect(arnsMatch, "expected to find cloudwatch_alarm_arns local").not.toBeNull();
    const arnLines = arnsMatch![1]
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(arnLines).toHaveLength(5);
    for (const name of ["alb-unhealthy-targets", "alb-5xx", "rds-cpu", "rds-low-storage", "rds-connections"]) {
      expect(arnsMatch![1]).toMatch(new RegExp(`schoolsync-staging-${name}`));
    }
    // Every entry is a concrete alarm ARN, never a bare wildcard resource.
    expect(arnsMatch![1]).not.toMatch(/:alarm:"\s*,|:alarm:\*/);
  });

  it("elasticache:ListTagsForResource is scoped to exactly the schoolsync-staging-redis subnet group ARN, never Resource: \"*\"", () => {
    const stmt = findSid("TerraformPlanElastiCacheTagsReadOnly");
    expect(stmt).toMatch(/actions\s*=\s*\["elasticache:ListTagsForResource"\]/);
    expect(stmt).toMatch(/resources\s*=\s*\[local\.elasticache_subnet_group_arn\]/);
    expect(content).toMatch(/elasticache_subnet_group_arn\s*=\s*"arn:aws:elasticache:\$\{var\.aws_region\}:\$\{var\.aws_account_id\}:subnetgroup:schoolsync-staging-redis"/);
  });

  it("servicediscovery:ListTagsForResource is a dedicated Resource: \"*\" statement — the one documented exception, no resource type existing for this action per AWS Cloud Map's IAM reference", () => {
    const stmt = findSid("TerraformPlanServiceDiscoveryTagsReadOnly");
    expect(stmt).toMatch(/actions\s*=\s*\["servicediscovery:ListTagsForResource"\]/);
    expect(stmt).toMatch(/resources\s*=\s*\["\*"\]/);
    // Documents WHY this is the one wildcard exception, not just that it is one.
    expect(stmt).toMatch(/no resource type/i);
    expect(stmt).toMatch(/does not support resource-level/i);
    // No other action is folded into this wildcard statement.
    const actionsMatch = stmt.match(/actions\s*=\s*\[([\s\S]*?)\]/);
    expect(actionsMatch).not.toBeNull();
    const actionCount = actionsMatch![1].split(",").map((s) => s.trim()).filter((s) => s.length > 0).length;
    expect(actionCount).toBe(1);
    // The old namespace-ARN local this statement used to reference is gone.
    expect(content).not.toMatch(/servicediscovery_namespace_arn/);
  });

  it("none of the other six new/modified statements uses Resource: \"*\" — the ServiceDiscovery statement is the sole, documented wildcard exception", () => {
    for (const sid of [
      "EcrReadForDeployVerification",
      "CloudWatchLogsReadForPostDeployVerification",
      "TerraformPlanSecretsMetadataOnly",
      "TerraformPlanS3BucketReadOnly",
      "TerraformPlanCloudWatchAlarmTagsReadOnly",
      "TerraformPlanElastiCacheTagsReadOnly",
    ]) {
      const stmt = findSid(sid);
      expect(stmt, sid).not.toMatch(/resources\s*=\s*\["\*"\]/);
    }
    // Exactly one Resource: "*" statement exists among all seven
    // new/modified statements from this fix.
    const wildcardCount = [
      "EcrReadForDeployVerification",
      "CloudWatchLogsReadForPostDeployVerification",
      "TerraformPlanSecretsMetadataOnly",
      "TerraformPlanS3BucketReadOnly",
      "TerraformPlanCloudWatchAlarmTagsReadOnly",
      "TerraformPlanElastiCacheTagsReadOnly",
      "TerraformPlanServiceDiscoveryTagsReadOnly",
    ].filter((sid) => /resources\s*=\s*\["\*"\]/.test(findSid(sid))).length;
    expect(wildcardCount).toBe(1);
  });

  it("no write, delete, mutation, IAM-administration, or state-write action was introduced anywhere in this file", () => {
    const forbidden = [
      /cloudwatch:(Put|Delete|Set)/,
      /elasticache:(Create|Modify|Delete)/,
      /ecr:(PutImage|DeleteRepository|PutLifecyclePolicy)/,
      /logs:(Put|Delete|Create)/,
      /servicediscovery:(Create|Delete|Update|Register|Deregister|TagResource|UntagResource)/,
      /secretsmanager:(PutSecretValue|RotateSecret|DeleteSecret|GetSecretValue)/,
      /s3:(PutObject|PutBucket|DeleteBucket)/,
      /iam:(CreateRole|DeleteRole|PutRolePolicy|AttachRolePolicy|CreatePolicy)/,
    ];
    for (const pattern of forbidden) {
      expect(cleanContent).not.toMatch(pattern);
    }
  });

  it("only one statement grants the new ListTagsForResource action for each of cloudwatch/elasticache/servicediscovery (elasticache and servicediscovery had no prior statement at all; cloudwatch's pre-existing DescribeAlarms statement is untouched and separate)", () => {
    for (const action of ["cloudwatch:ListTagsForResource", "elasticache:ListTagsForResource", "servicediscovery:ListTagsForResource"]) {
      const matching = statements.filter((s) => s.includes(`"${action}"`));
      expect(matching.length, action).toBe(1);
    }
    // cloudwatch:DescribeAlarms (pre-existing, TerraformPlanReadOnlyRefresh)
    // is the only other cloudwatch: action in the file — confirms the new
    // statement didn't get merged into or duplicate that one.
    const cloudwatchStatements = statements.filter((s) => /"cloudwatch:/.test(s));
    expect(cloudwatchStatements.length).toBe(2);
  });
});
