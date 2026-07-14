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

/**
 * The ECS `environment` block above is not sufficient on its own: every
 * task-definition rollout path in infra/scripts/*.ps1 registers a new
 * revision by copying the CURRENTLY LIVE container definition and patching
 * only the image (see infra/scripts/common.ps1's registration helper) —
 * `ecs.tf`'s `environment` list is structurally excluded from ever being
 * applied to an existing task definition via `terraform apply`
 * (`lifecycle { ignore_changes = [container_definitions] }`). So the CA
 * trust path must also be baked directly into the image itself via a
 * Dockerfile `ENV`, which every rollout path inherits regardless of which
 * script (or a raw `aws ecs register-task-definition`) creates the new
 * revision — no operator-supplied `docker run -e` flag required.
 */
const dockerfile = () => readFileSync(join(ROOT, "Dockerfile"), "utf-8");

describe("NODE_EXTRA_CA_CERTS is baked into the image itself (Dockerfile)", () => {
  it("the runner stage sets ENV NODE_EXTRA_CA_CERTS to the exact bundle path", () => {
    const runnerStage = dockerfile().match(/FROM \$\{NODE_IMAGE\} AS runner[\s\S]*/)![0];
    expect(runnerStage).toMatch(
      new RegExp(`\\r?\\nENV NODE_EXTRA_CA_CERTS=${EXPECTED_PATH.replace(/\//g, "\\/")}\\r?\\n`)
    );
  });

  it("the ENV is declared after the CA bundle is COPYed and permissioned, not before", () => {
    const runnerStage = dockerfile().match(/FROM \$\{NODE_IMAGE\} AS runner[\s\S]*/)![0];
    const copyIndex = runnerStage.indexOf("COPY certs/aws-rds-global-bundle.pem");
    const chmodIndex = runnerStage.indexOf("chmod 0444");
    const envIndex = runnerStage.indexOf("ENV NODE_EXTRA_CA_CERTS=");
    expect(copyIndex).toBeGreaterThan(-1);
    expect(chmodIndex).toBeGreaterThan(copyIndex);
    expect(envIndex).toBeGreaterThan(chmodIndex);
  });

  it("no earlier build stage (deps/builder/prod-deps) declares NODE_EXTRA_CA_CERTS", () => {
    const runnerStageStart = dockerfile().indexOf("FROM ${NODE_IMAGE} AS runner");
    const earlierStages = dockerfile().slice(0, runnerStageStart);
    expect(earlierStages).not.toMatch(/NODE_EXTRA_CA_CERTS/);
  });

  it("the vendored CA bundle is still chmod 0444 (read-only, non-writable by the runtime user)", () => {
    const runnerStage = dockerfile().match(/FROM \$\{NODE_IMAGE\} AS runner[\s\S]*/)![0];
    expect(runnerStage).toMatch(/chmod 0444 \/app\/certs\/aws-rds-global-bundle\.pem/);
  });

  it("USER nextjs is still declared (non-root runtime) after the CA bundle permissions are set", () => {
    const runnerStage = dockerfile().match(/FROM \$\{NODE_IMAGE\} AS runner[\s\S]*/)![0];
    const chmodIndex = runnerStage.indexOf("chmod 0444");
    const userIndex = runnerStage.indexOf("\nUSER nextjs");
    expect(userIndex).toBeGreaterThan(chmodIndex);
  });
});
