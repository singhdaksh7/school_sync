import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the RDS TLS-trust fix: all three ECS task
 * environments (web, worker, migrate) must set NODE_EXTRA_CA_CERTS to the
 * exact path where Dockerfile bakes in the vendored AWS RDS CA bundle
 * (certs/aws-rds-global-bundle.pem -> /app/certs/aws-rds-global-bundle.pem
 * in the image), so Node trusts the RDS certificate chain without any
 * client disabling verification. The worker doesn't query Postgres today,
 * but every task should carry identical TLS trust configuration so a
 * future change can't silently reintroduce a gap.
 *
 * \r?\n (not a bare \n) tolerates a CRLF checkout — see the equivalent note
 * in tests/email-iam-mapping.test.ts.
 */

const ROOT = process.cwd();
const ecs = () => readFileSync(join(ROOT, "infra", "terraform", "ecs.tf"), "utf-8");

const EXPECTED_PATH = "/app/certs/aws-rds-global-bundle.pem";

describe("NODE_EXTRA_CA_CERTS is set consistently on every ECS task (infra/terraform/ecs.tf)", () => {
  it("local.node_extra_ca_certs is defined with the exact expected path", () => {
    const match = ecs().match(/node_extra_ca_certs\s*=\s*"([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(EXPECTED_PATH);
  });

  it("web task environment references local.node_extra_ca_certs", () => {
    const webEnvironmentLocal = ecs().match(/web_environment = concat\(([\s\S]*?)\r?\n  \)\r?\n}/)![0];
    expect(webEnvironmentLocal).toMatch(/name\s*=\s*"NODE_EXTRA_CA_CERTS",\s*value\s*=\s*local\.node_extra_ca_certs/);
  });

  it("worker task definition references local.node_extra_ca_certs", () => {
    const workerTaskDef = ecs().match(/resource "aws_ecs_task_definition" "worker"[\s\S]*?\r?\n}\r?\n/)![0];
    expect(workerTaskDef).toMatch(/name\s*=\s*"NODE_EXTRA_CA_CERTS",\s*value\s*=\s*local\.node_extra_ca_certs/);
  });

  it("migrate task definition references local.node_extra_ca_certs", () => {
    const migrateTaskDef = ecs().match(/resource "aws_ecs_task_definition" "migrate"[\s\S]*?\r?\n}\r?\n/)![0];
    expect(migrateTaskDef).toMatch(/name\s*=\s*"NODE_EXTRA_CA_CERTS",\s*value\s*=\s*local\.node_extra_ca_certs/);
  });
});
