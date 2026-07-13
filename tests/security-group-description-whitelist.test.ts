import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for two EC2 CreateSecurityGroup/AuthorizeSecurityGroup
 * failures against security-groups.tf's AWS-bound `description` fields
 * (top-level group description, and every `ingress`/`egress` rule
 * description — AWS validates all of them, not just the top-level one):
 *
 *   1. A Unicode em dash ("—") in aws_security_group.alb's top-level
 *      description — CreateSecurityGroup rejected it outright ("Character
 *      sets beyond ASCII are not supported").
 *   2. A ">" in an aws_security_group.ecs_tasks ingress rule description
 *      ("worker -> web") — fully ASCII, so the first fix's non-ASCII check
 *      didn't catch it, but the AWS provider rejected it anyway because the
 *      real constraint is narrower than "ASCII": security-group rule
 *      descriptions must match
 *        ^[0-9A-Za-z_ .:/()#,@\[\]+=&;{}!$*-]*$
 *      (the exact pattern from the provider's own validation error), which
 *      excludes >, <, %, quotes, backslash, and other ASCII punctuation.
 *
 * This file checks against that exact whitelist rather than "ASCII", so it
 * catches both classes of bug and any future one shaped like them. It is
 * deliberately scoped to security-groups.tf only — CloudWatch alarm
 * descriptions (cloudwatch.tf) go through a different AWS API
 * (PutMetricAlarm) with its own, much more permissive validation (e.g. "+"
 * and "%" are fine there), so applying this EC2-specific whitelist to them
 * would be both wrong and untested by the actual failures this guards
 * against.
 *
 * All regexes use \r?\n rather than a bare \n so this test passes on both
 * LF-stored blobs and a CRLF checkout (Windows git core.autocrlf) — see the
 * equivalent note in tests/email-iam-mapping.test.ts.
 */

const ROOT = process.cwd();
const securityGroups = () => readFileSync(join(ROOT, "infra", "terraform", "security-groups.tf"), "utf-8");
const cloudwatch = () => readFileSync(join(ROOT, "infra", "terraform", "cloudwatch.tf"), "utf-8");

// Exact pattern from the AWS provider's own rejection message — see the
// docstring above. A value is valid when it matches this in full.
const AWS_SG_DESCRIPTION_WHITELIST = /^[0-9A-Za-z_ .:/()#,@[\]+=&;{}!$*-]*$/;
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

describe("EC2 security-group descriptions satisfy the AWS provider whitelist (infra/terraform/security-groups.tf)", () => {
  const sgNames = ["alb", "ecs_tasks", "rds", "redis"] as const;

  it("covers all four security groups (ALB, ECS tasks, RDS, Redis)", () => {
    // Sanity check the test itself is looking at the right resources before
    // asserting anything about their contents.
    for (const name of sgNames) {
      expect(securityGroups()).toMatch(new RegExp(`resource "aws_security_group" "${name}" \\{`));
    }
  });

  it.each(sgNames)("aws_security_group.%s: every description (top-level, ingress, egress) matches the AWS whitelist", (name) => {
    const block = extractResourceBlock(securityGroups(), "aws_security_group", name);
    const descriptions = descriptionValues(block);
    // Non-vacuous: fail loudly if extraction found nothing, rather than
    // silently passing an empty list.
    expect(descriptions.length).toBeGreaterThan(0);
    for (const value of descriptions) {
      expect(value).toMatch(AWS_SG_DESCRIPTION_WHITELIST);
    }
  });

  it("rejects the exact regression that broke the recovery apply (a bare '>' arrow)", () => {
    const block = extractResourceBlock(securityGroups(), "aws_security_group", "ecs_tasks");
    const withArrow = block.replace("worker to web", "worker -> web");
    expect(descriptionValues(withArrow).some((v) => !AWS_SG_DESCRIPTION_WHITELIST.test(v))).toBe(true);
  });

  it("rejects a reintroduced em dash (guards the original failure)", () => {
    const block = extractResourceBlock(securityGroups(), "aws_security_group", "alb");
    const withEmDash = block.replace('"Internet-facing ALB', '"Internet-facing ALB —');
    expect(descriptionValues(withEmDash).some((v) => !AWS_SG_DESCRIPTION_WHITELIST.test(v))).toBe(true);
  });

  it.each(["<", "%", "'", "\\", "|", "~", "^", "?"])("rejects any other character outside the whitelist (%s)", (char) => {
    const block = extractResourceBlock(securityGroups(), "aws_security_group", "rds");
    const tampered = block.replace("RDS PostgreSQL", `RDS PostgreSQL ${char}`);
    expect(descriptionValues(tampered).some((v) => !AWS_SG_DESCRIPTION_WHITELIST.test(v))).toBe(true);
  });
});

describe("CloudWatch alarm descriptions are ASCII-only, not held to the narrower EC2 whitelist (infra/terraform/cloudwatch.tf)", () => {
  it("every alarm_description value has no non-ASCII characters", () => {
    const values = [...cloudwatch().matchAll(/alarm_description\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toMatch(NON_ASCII);
    }
  });

  it("tolerates characters the EC2 security-group whitelist would reject (e.g. '%', '+')", () => {
    // Confirms this suite is deliberately not applying AWS_SG_DESCRIPTION_WHITELIST
    // here — CloudWatch's PutMetricAlarm has its own, more permissive rules.
    const values = [...cloudwatch().matchAll(/alarm_description\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(values.some((v) => !AWS_SG_DESCRIPTION_WHITELIST.test(v))).toBe(true);
  });
});
