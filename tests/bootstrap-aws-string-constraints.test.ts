import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AWS API field-level character-set audit for infra/bootstrap/github-oidc.
 *
 * `terraform validate`/`plan` never checks a string against an AWS API's
 * character-set constraints — only the live API call does. That gap let an
 * em-dash (U+2014) in both `aws_iam_role` `description` arguments reach
 * AWS's `CreateRole` call and fail with:
 *   ValidationError: Value at 'description' failed to satisfy constraint:
 *   Member must satisfy regular expression pattern:
 *   [\t\n\r\x20-\x7E¡-ÿ]*
 * (the exact pattern below is copied verbatim from that error, not
 * approximated). This suite is text/regex-based — same convention as
 * tests/github-oidc-bootstrap.test.ts — and uses a brace-balanced block
 * extractor (not a fixed-depth regex) because both role resources have a
 * nested `lifecycle { precondition { ... } }` block, so a naive
 * `\n}` closing-brace regex under-matches. \r?\n is never assumed as the
 * only line ending anywhere below — every check operates on raw file text,
 * so it is unaffected by CRLF vs LF checkouts.
 */

const ROOT = process.cwd();
const bootstrapDir = join(ROOT, "infra", "bootstrap", "github-oidc");
const tf = (name: string) => readFileSync(join(bootstrapDir, name), "utf-8");

/** AWS IAM CreateRole/CreatePolicy `description` field's own accepted range. */
const IAM_DESCRIPTION_PATTERN = /^[\t\n\r\x20-\x7E¡-ÿ]*$/;

/** IAM role/policy *names* accept a narrower set per the IAM API reference. */
const IAM_NAME_PATTERN = /^[\w+=,.@-]+$/;

/**
 * Extracts a brace-balanced HCL block starting at the first "{" at or after
 * `startMarker`, counting braces (the same technique as
 * tests/github-oidc-bootstrap.test.ts's extractBlock — braces inside
 * "${...}" interpolations are each internally balanced, so the running
 * depth count stays correct regardless).
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

/** Reads a top-level `key = "value"` string argument out of an extracted block (not inside a nested sub-block). */
function extractStringArg(block: string, arg: string): string {
  const match = block.match(new RegExp(`\\n\\s*${arg}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) throw new Error(`argument "${arg}" not found in block`);
  return match[1];
}

describe("AWS-bound string audit: infra/bootstrap/github-oidc", () => {
  describe("aws_iam_role descriptions — sent to AWS CreateRole (the exact field that failed)", () => {
    const cases: Array<{ file: string; resourceName: string }> = [
      { file: "iam-build-role.tf", resourceName: "github_staging_build" },
      { file: "iam-deploy-role.tf", resourceName: "github_staging_deploy" },
    ];

    for (const { file, resourceName } of cases) {
      it(`aws_iam_role.${resourceName}'s description matches AWS IAM's accepted character range`, () => {
        const block = extractBlock(tf(file), `resource "aws_iam_role" "${resourceName}"`);
        const description = extractStringArg(block, "description");
        expect(description.length).toBeGreaterThan(0); // sanity: real text was actually found
        expect(description).toMatch(IAM_DESCRIPTION_PATTERN);
      });

      it(`aws_iam_role.${resourceName}'s description contains no em dash, en dash, or other non-ASCII punctuation`, () => {
        const block = extractBlock(tf(file), `resource "aws_iam_role" "${resourceName}"`);
        const description = extractStringArg(block, "description");
        expect(description).not.toContain("—"); // em dash — the exact character that broke CreateRole
        expect(description).not.toContain("–"); // en dash — same failure mode
        expect(/^[\x00-\x7F]*$/.test(description)).toBe(true); // plain ASCII, not just "within IAM's range"
      });
    }
  });

  describe("aws_iam_role / aws_iam_role_policy names — AWS-bound identifiers", () => {
    it("both role names satisfy IAM's role-name character set and are unchanged", () => {
      const build = extractStringArg(extractBlock(tf("iam-build-role.tf"), 'resource "aws_iam_role" "github_staging_build"'), "name");
      const deploy = extractStringArg(extractBlock(tf("iam-deploy-role.tf"), 'resource "aws_iam_role" "github_staging_deploy"'), "name");
      expect(build).toMatch(IAM_NAME_PATTERN);
      expect(deploy).toMatch(IAM_NAME_PATTERN);
      expect(build).toBe("schoolsync-github-staging-build");
      expect(deploy).toBe("schoolsync-github-staging-deploy");
    });

    it("both inline role-policy names satisfy IAM's policy-name character set and are unchanged", () => {
      const buildPolicy = extractStringArg(extractBlock(tf("iam-build-role.tf"), 'resource "aws_iam_role_policy" "github_staging_build"'), "name");
      const deployPolicy = extractStringArg(extractBlock(tf("iam-deploy-role.tf"), 'resource "aws_iam_role_policy" "github_staging_deploy"'), "name");
      expect(buildPolicy).toMatch(IAM_NAME_PATTERN);
      expect(deployPolicy).toMatch(IAM_NAME_PATTERN);
      expect(buildPolicy).toBe("schoolsync-github-staging-build-ecr-push");
      expect(deployPolicy).toBe("schoolsync-github-staging-deploy-ecs-and-tf-readonly");
    });
  });

  describe("OIDC provider AWS-bound values", () => {
    it("url and client_id_list are plain ASCII", () => {
      const block = extractBlock(tf("oidc-provider.tf"), 'resource "aws_iam_openid_connect_provider" "github"');
      const url = extractStringArg(block, "url");
      const clientIds = [...block.matchAll(/client_id_list\s*=\s*\[([\s\S]*?)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/"([^"]*)"/g)])
        .map((m) => m[1]);
      expect(url).toBe("https://token.actions.githubusercontent.com");
      expect(/^[\x00-\x7F]*$/.test(url)).toBe(true);
      expect(clientIds.length).toBeGreaterThan(0);
      for (const id of clientIds) {
        expect(/^[\x00-\x7F]*$/.test(id)).toBe(true);
      }
    });
  });

  describe("default_tags — AWS-bound tag values applied to every resource in this stack", () => {
    it("every default tag value is plain ASCII", () => {
      const content = readFileSync(join(bootstrapDir, "providers.tf"), "utf-8");
      const tagsBlock = extractBlock(content, "tags =");
      const values = [...tagsBlock.matchAll(/=\s*"([^"]*)"/g)].map((m) => m[1]);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(/^[\x00-\x7F]*$/.test(value)).toBe(true);
      }
    });
  });

  describe("Comments and Terraform-only metadata are intentionally unaffected by this audit", () => {
    it("variable descriptions (never sent to AWS) still legitimately contain em dashes, proving the fix was scoped to AWS-bound arguments only", () => {
      const content = tf("variables.tf");
      const hasEmDashInVariableDescription = /variable\s+"[^"]+"\s*\{[\s\S]*?description\s*=\s*"[^"]*—[^"]*"/.test(content);
      expect(hasEmDashInVariableDescription).toBe(true);
    });

    it("output descriptions (never sent to AWS) still legitimately contain em dashes", () => {
      const content = readFileSync(join(bootstrapDir, "outputs.tf"), "utf-8");
      expect(content).toMatch(/description = "[^"]*—[^"]*"/);
    });

    it("comment lines (never sent to AWS) still legitimately contain box-drawing/em-dash characters", () => {
      const content = tf("iam-build-role.tf");
      const commentLines = content.split(/\r?\n/).filter((l) => l.trim().startsWith("#"));
      expect(commentLines.some((l) => /[─—]/.test(l))).toBe(true);
    });
  });
});
