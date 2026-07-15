import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the first GitHub OIDC staging deploy failure on
 * the Terraform backend: schoolsync-github-staging-deploy's preflight
 * (STEP A) calls `aws s3api head-bucket` and `aws dynamodb describe-table`
 * against the existing state bucket/lock table as pure existence checks.
 * Both were denied even though the resources exist and the role already had
 * scoped state-object/lock item access:
 *
 * - HeadBucket's IAM check is s3:ListBucket with NO s3:prefix in the request
 *   context (HeadBucket has no prefix parameter) — the pre-existing
 *   TerraformStateBucketListForRefresh statement conditions s3:ListBucket on
 *   `s3:prefix StringLike <state key>`, and a condition key absent from the
 *   request evaluates false, so that statement can never authorize
 *   HeadBucket. Confirmed via `aws iam simulate-principal-policy` against
 *   the live role (implicitDeny) before this fix.
 * - dynamodb:DescribeTable was never granted at all — only GetItem/PutItem/
 *   DeleteItem (lock acquire/release), which don't cover a table-existence
 *   read.
 *
 * Fix: one new unconditional s3:ListBucket statement (bucket-only resource,
 * no object suffix, no "*") for HeadBucket's own check, and
 * dynamodb:DescribeTable added to the existing lock statement's action
 * list, same exact table resource. No s3:PutObject, no Resource: "*", no
 * broadening of the existing state-object/lock scoping.
 *
 * Text/regex-based, matching the convention in
 * tests/github-oidc-bootstrap.test.ts (this stack is never applied by CI —
 * see tests/ci-cd-workflow-security.test.ts — so these are the only
 * automated guard against a future edit reintroducing Resource: "*" or
 * broader bucket/table access here).
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

describe("Deploy role: Terraform backend preflight permissions (HeadBucket / DescribeTable)", () => {
  const content = tf("iam-deploy-role.tf");
  const perms = extractBlock(content, 'data "aws_iam_policy_document" "deploy_permissions"');
  const statements = extractStatements(perms);

  const findSid = (sid: string) => {
    const found = statements.find((s) => new RegExp(`sid\\s*=\\s*"${sid}"`).test(s));
    expect(found, `expected to find a statement with sid "${sid}"`).toBeDefined();
    return found!;
  };

  it("grants an unconditional s3:ListBucket for HeadBucket's own check, scoped to exactly the state bucket (no object suffix, no wildcard)", () => {
    const stmt = findSid("TerraformStateBucketHeadBucketPreflight");
    expect(stmt).toMatch(/actions\s*=\s*\["s3:ListBucket"\]/);
    expect(stmt).toMatch(/resources\s*=\s*\["arn:aws:s3:::\$\{var\.terraform_state_bucket\}"\]/);
    // Unconditional: HeadBucket sends no s3:prefix, so this statement must
    // not carry a condition block (a condition here would just reproduce
    // the original bug).
    expect(stmt).not.toMatch(/condition\s*\{/);
    // Must not also grant object-level access — existence-check only.
    // (stripComments: the comment above legitimately names s3:GetObject to
    // explain its absence, not as an actual granted action.)
    expect(stripComments(stmt)).not.toMatch(/s3:GetObject/);
  });

  it("leaves the original prefix-conditioned ListBucket-for-refresh statement untouched", () => {
    const stmt = findSid("TerraformStateBucketListForRefresh");
    expect(stmt).toMatch(/actions\s*=\s*\["s3:ListBucket"\]/);
    expect(stmt).toMatch(/resources\s*=\s*\["arn:aws:s3:::\$\{var\.terraform_state_bucket\}"\]/);
    expect(stmt).toMatch(/condition\s*\{/);
    expect(stmt).toMatch(/test\s*=\s*"StringLike"/);
    expect(stmt).toMatch(/variable\s*=\s*"s3:prefix"/);
    expect(stmt).toMatch(/values\s*=\s*\[var\.terraform_state_key\]/);
  });

  it("exactly two statements grant s3:ListBucket on the state bucket (the original conditioned one plus the new unconditional one) — not a third, broader grant", () => {
    const listBucketStatements = statements.filter(
      (s) => /actions\s*=\s*\["s3:ListBucket"\]/.test(s) && /terraform_state_bucket/.test(s),
    );
    expect(listBucketStatements.length).toBe(2);
  });

  it("adds dynamodb:DescribeTable to the existing lock statement, same exact table resource, alongside the unchanged GetItem/PutItem/DeleteItem actions", () => {
    const stmt = findSid("TerraformStateLock");
    expect(stmt).toMatch(/actions\s*=\s*\[\s*"dynamodb:GetItem",\s*"dynamodb:PutItem",\s*"dynamodb:DeleteItem",\s*"dynamodb:DescribeTable"\s*\]/);
    expect(stmt).toMatch(/resources\s*=\s*\["arn:aws:dynamodb:\$\{var\.aws_region\}:\$\{var\.aws_account_id\}:table\/\$\{var\.terraform_lock_table\}"\]/);
  });

  it("only one statement in this policy document grants any dynamodb: action, and it is scoped to exactly the lock table (never Resource: \"*\")", () => {
    const dynamoStatements = statements.filter((s) => /"dynamodb:/.test(s));
    expect(dynamoStatements.length).toBe(1);
    expect(dynamoStatements[0]).toMatch(/resources\s*=\s*\["arn:aws:dynamodb:/);
    expect(dynamoStatements[0]).not.toMatch(/resources\s*=\s*\["\*"\]/);
  });

  it("s3:PutObject is still granted nowhere in this file — this role remains structurally unable to write Terraform state", () => {
    expect(stripComments(content)).not.toMatch(/s3:PutObject/);
  });

  it("neither the new HeadBucket statement nor the lock statement uses Resource: \"*\"", () => {
    const headBucketStmt = findSid("TerraformStateBucketHeadBucketPreflight");
    const lockStmt = findSid("TerraformStateLock");
    expect(headBucketStmt).not.toMatch(/resources\s*=\s*\["\*"\]/);
    expect(lockStmt).not.toMatch(/resources\s*=\s*\["\*"\]/);
  });

  it("the state-object read (s3:GetObject) statement is unchanged — exact object key, no broadening to the whole bucket", () => {
    const stmt = findSid("TerraformStateReadOnly");
    expect(stmt).toMatch(/actions\s*=\s*\["s3:GetObject"\]/);
    expect(stmt).toMatch(/resources\s*=\s*\["arn:aws:s3:::\$\{var\.terraform_state_bucket\}\/\$\{var\.terraform_state_key\}"\]/);
  });
});
