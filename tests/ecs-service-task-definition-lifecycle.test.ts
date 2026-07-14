import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the ECS-service rollback blocker: aws_ecs_service.web
 * and .worker had no `lifecycle { ignore_changes = [...] }` block at all, so
 * Terraform's own tracked `task_definition` (whatever revision it last
 * created) drifted from the live revision registered out-of-band by
 * infra/scripts/update-web-service.ps1 / update-worker-service.ps1 /
 * deploy-staging.ps1 (STEP F/I). A real-state plan confirmed this: it
 * attempted to roll both services from the live revision (:2) back to
 * Terraform's own (:1). This is the same pattern already applied to the
 * *task-definition* resources' own `container_definitions` (see
 * aws_ecs_task_definition.web/worker/migrate) — this file extends it to the
 * *service* resources' `task_definition` reference.
 *
 * Text/regex-based, matching the existing convention in
 * tests/security-group-description-whitelist.test.ts and
 * tests/deploy-staging-rollout.test.ts (no HCL parser dependency). \r?\n
 * (never a bare \n across a line boundary) tolerates this repo's CRLF
 * checkout.
 */

const ROOT = process.cwd();
const ecsTfPath = join(ROOT, "infra", "terraform", "ecs.tf");
const scriptsDir = join(ROOT, "infra", "scripts");
const ecsTf = () => readFileSync(ecsTfPath, "utf-8");
const script = (name: string) => readFileSync(join(scriptsDir, name), "utf-8");

function extractResourceBlock(source: string, type: string, name: string): string {
  // A top-level HCL block's own closing brace is always unindented ("}" at
  // column 0); every nested block (network_configuration, load_balancer,
  // lifecycle, ...) closes with an indented "  }". This lets a non-greedy
  // match stop at the resource's own close rather than the first nested one.
  const re = new RegExp(`resource "${type}" "${name}" \\{[\\s\\S]*?\\r?\\n\\}\\r?\\n`);
  const match = source.match(re);
  expect(match, `expected to find resource "${type}" "${name}" in ecs.tf`).not.toBeNull();
  return match![0];
}

function extractLifecycleBlock(resourceBlock: string): string | null {
  const match = resourceBlock.match(/lifecycle \{[\s\S]*?\r?\n  \}\r?\n/);
  return match ? match[0] : null;
}

function ignoreChangesList(lifecycleBlock: string): string {
  const match = lifecycleBlock.match(/ignore_changes\s*=\s*\[([\s\S]*?)\]/);
  expect(match, "expected an ignore_changes = [...] list inside the lifecycle block").not.toBeNull();
  return match![1];
}

const SERVICE_NAMES = ["web", "worker"] as const;

describe("Requirement 1: both ECS services ignore task_definition drift", () => {
  it.each(SERVICE_NAMES)("aws_ecs_service.%s has a lifecycle block that ignores task_definition", (name) => {
    const block = extractResourceBlock(ecsTf(), "aws_ecs_service", name);
    const lifecycle = extractLifecycleBlock(block);
    expect(lifecycle, `expected a lifecycle block inside aws_ecs_service.${name}`).not.toBeNull();
    const list = ignoreChangesList(lifecycle!);
    expect(list).toMatch(/\btask_definition\b/);
  });
});

describe("Requirement 2: neither service ignores desired_count", () => {
  it.each(SERVICE_NAMES)("aws_ecs_service.%s's ignore_changes does not include desired_count", (name) => {
    const block = extractResourceBlock(ecsTf(), "aws_ecs_service", name);
    const lifecycle = extractLifecycleBlock(block);
    expect(lifecycle).not.toBeNull();
    const list = ignoreChangesList(lifecycle!);
    expect(list).not.toMatch(/\bdesired_count\b/);
  });
});

describe("Requirement 3: no broad ignore_changes = all anywhere in ecs.tf", () => {
  it("never ignores every attribute on any resource", () => {
    expect(ecsTf()).not.toMatch(/ignore_changes\s*=\s*all\b/);
  });

  it("both services' ignore_changes list is exactly [task_definition], not a wider set", () => {
    for (const name of SERVICE_NAMES) {
      const block = extractResourceBlock(ecsTf(), "aws_ecs_service", name);
      const lifecycle = extractLifecycleBlock(block);
      const list = ignoreChangesList(lifecycle!).trim();
      expect(list).toBe("task_definition");
    }
  });
});

describe("Requirement 4: networking, load-balancer, and service-discovery config remain Terraform-managed", () => {
  it("aws_ecs_service.web still declares network_configuration, load_balancer, and service_registries as live (non-ignored) blocks", () => {
    const block = extractResourceBlock(ecsTf(), "aws_ecs_service", "web");
    expect(block).toMatch(/network_configuration\s*\{/);
    expect(block).toMatch(/load_balancer\s*\{/);
    expect(block).toMatch(/service_registries\s*\{/);
    const lifecycle = extractLifecycleBlock(block);
    const list = ignoreChangesList(lifecycle!);
    expect(list).not.toMatch(/network_configuration|load_balancer|service_registries/);
  });

  it("aws_ecs_service.worker still declares network_configuration as a live (non-ignored) block", () => {
    const block = extractResourceBlock(ecsTf(), "aws_ecs_service", "worker");
    expect(block).toMatch(/network_configuration\s*\{/);
    const lifecycle = extractLifecycleBlock(block);
    const list = ignoreChangesList(lifecycle!);
    expect(list).not.toMatch(/network_configuration/);
  });

  it("deployment/capacity settings (circuit breaker, rolling percentages) remain live on both services", () => {
    for (const name of SERVICE_NAMES) {
      const block = extractResourceBlock(ecsTf(), "aws_ecs_service", name);
      expect(block).toMatch(/deployment_minimum_healthy_percent\s*=\s*100/);
      expect(block).toMatch(/deployment_maximum_percent\s*=\s*200/);
      expect(block).toMatch(/deployment_circuit_breaker\s*\{/);
    }
  });
});

describe("Requirement 5: the deployment scripts remain solely responsible for explicit web/worker task-definition updates", () => {
  it("Update-EcsServiceImage (common.ps1) still issues an explicit --task-definition update-service call", () => {
    const fn = script("common.ps1").match(/function Update-EcsServiceImage \{[\s\S]*?\r?\n\}\r?\n/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/"--task-definition",\s*\$newArn/);
    expect(fn![0]).toMatch(/"--force-new-deployment"/);
  });

  it("update-web-service.ps1 and update-worker-service.ps1 both route through Update-EcsServiceImage", () => {
    expect(script("update-web-service.ps1")).toMatch(/Update-EcsServiceImage/);
    expect(script("update-worker-service.ps1")).toMatch(/Update-EcsServiceImage/);
  });
});
