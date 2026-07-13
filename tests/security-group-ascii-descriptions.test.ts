import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the EC2 CreateSecurityGroup failure: AWS rejects
 * any non-ASCII character (e.g. a Unicode em dash "—") in a security
 * group's `description` — including the description on `ingress`/`egress`
 * rule blocks, which map to the rule-level Description field AWS also
 * validates. The bug slipped in because the rest of this codebase's .tf
 * comments freely use em dashes for prose, and one was accidentally copied
 * into an actual AWS-bound field string instead of a `#` comment.
 *
 * This only checks fields that are genuinely sent to an AWS API
 * (security-group / rule descriptions, CloudWatch alarm descriptions) —
 * `#` comments, `variable`/`output` block `description`s, and Terraform
 * `error_message` strings (lifecycle pre/postconditions, CLI-only output)
 * are deliberately not in scope; those never reach AWS and support full
 * Unicode.
 *
 * All regexes use \r?\n rather than a bare \n so this test passes on both
 * LF-stored blobs and a CRLF checkout (Windows git core.autocrlf) — see the
 * equivalent note in tests/email-iam-mapping.test.ts.
 */

const ROOT = process.cwd();
const securityGroups = () => readFileSync(join(ROOT, "infra", "terraform", "security-groups.tf"), "utf-8");
const cloudwatch = () => readFileSync(join(ROOT, "infra", "terraform", "cloudwatch.tf"), "utf-8");

const NON_ASCII = /[^\x00-\x7F]/;

function extractResourceBlock(source: string, type: string, name: string): string {
  const re = new RegExp(`resource "${type}" "${name}" \\{[\\s\\S]*?\\r?\\n\\}\\r?\\n`);
  const match = source.match(re);
  expect(match, `expected to find resource "${type}" "${name}" in the source`).not.toBeNull();
  return match![0];
}

function descriptionValues(block: string): string[] {
  // Matches `description = "..."` and the wider-aligned `description     = "..."`
  // used inside ingress/egress sub-blocks — both forms appear in this file.
  return [...block.matchAll(/description\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
}

describe("EC2 security-group descriptions are ASCII-only (infra/terraform/security-groups.tf)", () => {
  const sgNames = ["alb", "ecs_tasks", "rds", "redis"] as const;

  it("covers all four security groups (ALB, ECS tasks, RDS, Redis)", () => {
    // Sanity check the test itself is looking at the right resources before
    // asserting anything about their contents.
    for (const name of sgNames) {
      expect(securityGroups()).toMatch(new RegExp(`resource "aws_security_group" "${name}" \\{`));
    }
  });

  it.each(sgNames)("aws_security_group.%s has no non-ASCII characters in any description (top-level or rule)", (name) => {
    const block = extractResourceBlock(securityGroups(), "aws_security_group", name);
    const descriptions = descriptionValues(block);
    expect(descriptions.length).toBeGreaterThan(0); // sanity: the block actually has description fields to check
    for (const value of descriptions) {
      expect(value).not.toMatch(NON_ASCII);
    }
  });

  it("rejects a reintroduced em dash (guards the exact regression)", () => {
    const block = extractResourceBlock(securityGroups(), "aws_security_group", "alb");
    const withEmDash = block.replace('"Internet-facing ALB', '"Internet-facing ALB —');
    expect(descriptionValues(withEmDash).some((v) => NON_ASCII.test(v))).toBe(true);
  });
});

describe("CloudWatch alarm descriptions are ASCII-only (infra/terraform/cloudwatch.tf)", () => {
  it("every alarm_description value has no non-ASCII characters", () => {
    const values = [...cloudwatch().matchAll(/alarm_description\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toMatch(NON_ASCII);
    }
  });
});
