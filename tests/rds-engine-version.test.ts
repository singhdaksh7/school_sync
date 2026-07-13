import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the PostgreSQL engine-version lookup in
 * infra/terraform/rds.tf.
 *
 * Root cause this guards against: `preferred_versions` on
 * `data.aws_rds_engine_version` requires an *exact* engine version string
 * (e.g. "16.14") — passing a bare major version (e.g. "16", the
 * `db_major_engine_version` default) makes the AWS provider error with
 * "no RDS engine versions match the criteria and preferred versions" against
 * real AWS API results, even though a matching 16.x version exists. The
 * fix is the provider's documented partial-version lookup: `version`
 * (accepts a bare major) + `latest = true`, reading the resolved value back
 * via `version_actual` (the concrete version AWS selected — `version` alone
 * just echoes the input query, not the resolution).
 *
 * All regexes below use \r?\n rather than a bare \n so this test passes on
 * both LF-stored blobs and a CRLF checkout (Windows git core.autocrlf) —
 * see the equivalent note in tests/email-iam-mapping.test.ts.
 */

const ROOT = process.cwd();
const rds = () => readFileSync(join(ROOT, "infra", "terraform", "rds.tf"), "utf-8");
const variables = () => readFileSync(join(ROOT, "infra", "terraform", "variables.tf"), "utf-8");
const tfvarsExample = () => readFileSync(join(ROOT, "infra", "terraform", "terraform.tfvars.example"), "utf-8");

describe("RDS PostgreSQL engine-version lookup (infra/terraform/rds.tf)", () => {
  const engineVersionBlock = () => {
    const match = rds().match(/data "aws_rds_engine_version" "postgres" \{[\s\S]*?\r?\n\}\r?\n/);
    expect(match).not.toBeNull();
    return match![0];
  };

  const dbInstanceBlock = () => {
    const match = rds().match(/resource "aws_db_instance" "main" \{[\s\S]*?\r?\n\}\r?\n/);
    expect(match).not.toBeNull();
    return match![0];
  };

  it("uses the partial-version `version` argument, not `preferred_versions`", () => {
    const block = engineVersionBlock();
    expect(block).toMatch(/version\s*=\s*var\.db_major_engine_version/);
    expect(block).not.toMatch(/preferred_versions/);
  });

  it("keeps `latest = true` so the newest matching minor is always selected", () => {
    expect(engineVersionBlock()).toMatch(/latest\s*=\s*true/);
  });

  it("aws_db_instance.main consumes the fully resolved version_actual attribute", () => {
    const block = dbInstanceBlock();
    expect(block).toMatch(/engine_version\s*=\s*data\.aws_rds_engine_version\.postgres\.version_actual/);
    // Guard against silently reverting to the unresolved `.version` echo —
    // it must not appear as the engine_version assignment.
    expect(block).not.toMatch(/engine_version\s*=\s*data\.aws_rds_engine_version\.postgres\.version\b(?!_actual)/);
  });

  it("commits no exact PostgreSQL minor version (e.g. 16.14) as a hardcoded override", () => {
    // A real minor looks like MAJOR.MINOR (e.g. "16.14"); the only "16" that
    // may appear is the bare major-version default, never a dotted minor.
    expect(rds()).not.toMatch(/16\.\d+/);
    expect(tfvarsExample()).not.toMatch(/16\.\d+/);
  });

  it("db_major_engine_version defaults to the bare major version \"16\"", () => {
    const block = variables().match(/variable "db_major_engine_version" \{[\s\S]*?\r?\n\}\r?\n/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/type\s*=\s*string/);
    expect(block![0]).toMatch(/default\s*=\s*"16"/);
  });
});
