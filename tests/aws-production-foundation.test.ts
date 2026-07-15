import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("AWS production foundation", () => {
  const workflow = read(".github", "workflows", "deploy-production.yml");
  const productionVars = read("infra", "terraform", "production.tfvars.example");
  const ecs = read("infra", "terraform", "ecs.tf");
  const rds = read("infra", "terraform", "rds.tf");
  const redis = read("infra", "terraform", "elasticache.tf");
  const dns = read("infra", "terraform", "acm-dns.tf");
  const alb = read("infra", "terraform", "alb.tf");
  const schedules = read("infra", "terraform", "maintenance-schedules.tf");

  it("deploys only exact main through an explicit production-enable gate and protected production Environment", () => {
    expect(workflow).toMatch(/branches:\s*\[main\]/);
    expect(workflow).toMatch(/vars\.PRODUCTION_BUILD_ENABLED == 'true' && github\.ref == 'refs\/heads\/main'/);
    expect(workflow).toMatch(/vars\.PRODUCTION_DEPLOY_ENABLED == 'true' && github\.ref == 'refs\/heads\/main'/);
    expect(workflow).toMatch(/environment:\s*production/);
    expect(workflow).toMatch(/vars\.PRODUCTION_BUILD_ROLE_ARN/);
    expect(workflow).toMatch(/vars\.PRODUCTION_DEPLOY_ROLE_ARN/);
    expect(workflow).toMatch(/-DeploymentEnvironment production/);
    expect(workflow).toMatch(/-RequireTerraformNoChanges/);
    expect(workflow).not.toMatch(/pilot\.zipinnovate\.com/);
  });

  it("keeps production DNS and maintenance inert in the initial template", () => {
    expect(productionVars).toMatch(/environment\s*=\s*"production"/);
    expect(productionVars).toMatch(/domain_name\s*=\s*"www\.zipinnovate\.com"/);
    expect(productionVars).toMatch(/redirect_domain_name\s*=\s*"zipinnovate\.com"/);
    expect(productionVars).toMatch(/verification_domain_name\s*=\s*"aws-production\.zipinnovate\.com"/);
    expect(productionVars).toMatch(/manage_domain_dns_record\s*=\s*false/);
    expect(productionVars).toMatch(/enable_maintenance_schedules\s*=\s*false/);
    expect(dns).toMatch(/local\.has_zone && var\.manage_domain_dns_record/);
    expect(dns).toMatch(/var\.redirect_domain_name/);
    expect(alb).toMatch(/resource "aws_lb_listener_rule" "redirect_alternate_domain"/);
    expect(alb).toMatch(/host\s*=\s*var\.domain_name/);
  });

  it("requires private ECS, NAT, Multi-AZ RDS/Valkey, backups, deletion protection, HTTPS, and SES for production", () => {
    expect(ecs).toMatch(/environment != "production" \|\| var\.ecs_use_private_subnets/);
    expect(ecs).toMatch(/environment != "production" \|\| var\.enable_nat_gateway/);
    expect(ecs).toMatch(/startswith\(var\.app_base_url, "https:\/\/"\)/);
    expect(ecs).toMatch(/var\.redirect_domain_name != ""/);
    expect(ecs).toMatch(/lower\(var\.email_provider\) == "ses"/);
    expect(rds).toMatch(/environment != "production" \|\| var\.db_multi_az/);
    expect(rds).toMatch(/environment != "production" \|\| var\.db_deletion_protection == true/);
    expect(rds).toMatch(/environment != "production" \|\| var\.db_skip_final_snapshot == false/);
    expect(redis).toMatch(/environment != "production" \|\| var\.redis_multi_az/);
  });

  it("uses the existing worker secret for AWS-native maintenance without introducing a plaintext credential", () => {
    expect(schedules).toMatch(/key\s*=\s*"x-worker-secret"/);
    expect(schedules).toMatch(/value\s*=\s*random_password\.job_worker_secret\.result/);
    expect(schedules).toMatch(/events:InvokeApiDestination/);
    expect(schedules).toMatch(/var\.enable_maintenance_schedules \?/);
    expect(schedules).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{16,}/);
  });
});

describe("Vercel is preview-only after AWS cutover", () => {
  const config = JSON.parse(read("vercel.json")) as {
    git?: { deploymentEnabled?: Record<string, boolean> };
  };

  it("disables main while leaving unspecified PR branches enabled for Preview deployments", () => {
    expect(config.git?.deploymentEnabled).toEqual({ main: false });
  });
});

describe("production GitHub OIDC trust", () => {
  const vars = read("infra", "bootstrap", "github-oidc", "variables.tf");
  const build = read("infra", "bootstrap", "github-oidc", "iam-build-role.tf");
  const deploy = read("infra", "bootstrap", "github-oidc", "iam-deploy-role.tf");
  const example = read("infra", "bootstrap", "github-oidc", "production.tfvars.example");

  it("maps production to exact main and exact production Environment with environment-scoped AWS names", () => {
    expect(vars).toMatch(/contains\(\["staging", "production"\], var\.deployment_environment\)/);
    expect(build).toMatch(/deployment_environment == "production" && var\.github_branch == "main"/);
    expect(deploy).toMatch(/var\.github_environment == var\.deployment_environment/);
    expect(deploy).toMatch(/application_name_prefix\s*=\s*"\$\{var\.project_name\}-\$\{var\.deployment_environment\}"/);
    expect(example).toMatch(/github_branch\s*=\s*"main"/);
    expect(example).toMatch(/github_environment\s*=\s*"production"/);
    expect(example).toMatch(/github_oidc_provider_arn\s*=\s*"REPLACE_WITH_EXISTING_GITHUB_OIDC_PROVIDER_ARN"/);
  });
});
