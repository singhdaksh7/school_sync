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
  const locals = read("infra", "terraform", "locals.tf");

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

  // Regression: the HTTPS listener (alb.tf's aws_lb_listener.https certificate_arn
  // = local.certificate_arn) must never attach a certificate ACM is still
  // validating. The Route53-managed path must derive the listener cert from
  // the *validation* resource, not the raw, immediately-available-but-
  // possibly-PENDING_VALIDATION aws_acm_certificate ARN — and the
  // manual/external-DNS path (no zone) must produce no usable cert at all
  // rather than attaching an unvalidated one.
  it("derives the HTTPS listener certificate from the validated ACM resource, not the raw pending certificate", () => {
    expect(locals).toMatch(/local\.has_existing_cert \? var\.alb_certificate_arn/);
    expect(locals).toMatch(/local\.create_managed_cert && local\.has_zone \? aws_acm_certificate_validation\.app\[0\]\.certificate_arn/);
    // The raw aws_acm_certificate.app[0].arn must never be assigned directly
    // to certificate_arn (it may legitimately appear elsewhere, e.g. as the
    // validation resource's own certificate_arn input in acm-dns.tf).
    const certificateArnLocal = locals.match(/certificate_arn\s*=\s*local\.has_existing_cert[\s\S]*?\r?\n\s*\)\r?\n/);
    expect(certificateArnLocal, "expected to find the certificate_arn local assignment").not.toBeNull();
    expect(certificateArnLocal![0]).not.toMatch(/aws_acm_certificate\.app\[0\]\.arn/);
  });

  it("manual/external-DNS certificate path (domain, no zone) never enables HTTPS from an unvalidated certificate", () => {
    // No aws_acm_certificate_validation resource exists for the no-zone path
    // (its count is gated on local.has_zone), so certificate_arn correctly
    // falls through to "" in that branch, and enable_https requires a
    // non-empty certificate_arn.
    expect(dns).toMatch(/count\s*=\s*local\.create_managed_cert && local\.has_zone \? 1 : 0/);
    expect(locals).toMatch(/enable_https\s*=\s*local\.has_domain && local\.certificate_arn\s*!=\s*""/);
    // Documents the two-stage manual flow rather than silently doing nothing.
    expect(dns.toLowerCase()).toMatch(/two-stage/);
  });
});

describe("deploy-production.yml post-deploy verification fails closed", () => {
  const workflow = read(".github", "workflows", "deploy-production.yml");

  function extractStep(content: string, stepMarker: string, nextMarker: string): string {
    const start = content.indexOf(stepMarker);
    expect(start, `expected to find step marker: ${stepMarker}`).toBeGreaterThan(-1);
    const end = content.indexOf(nextMarker, start + stepMarker.length);
    expect(end, `expected to find next marker after ${stepMarker}: ${nextMarker}`).toBeGreaterThan(-1);
    return content.slice(start, end);
  }

  // Regression: the previous version only checked $container.image against
  // the commit-SHA tag, so a tag re-pushed/overwritten in ECR after the
  // build job recorded its digest would pass verification while running
  // different image bytes than what was actually built and scanned.
  it("verifies every running container's imageDigest against build-and-scan's recorded digest, in addition to the tag", () => {
    const step = extractStep(workflow, 'Write-Step "Verifying running containers use the expected commit image tag AND digest"', 'Write-Step "Verifying ALB target health"');
    expect(step).toMatch(/\$expectedDigest\s*=\s*"\$\{\{\s*needs\.build-and-scan\.outputs\.image_digest\s*\}\}"/);
    expect(step).toMatch(/\$tagOk\s*=\s*\$container\.image\s*-match/);
    expect(step).toMatch(/\$digestOk\s*=.*\$container\.imageDigest\s*-eq\s*\$expectedDigest/);
    expect(step).toMatch(/if\s*\(-not\s*\$tagOk\s*-or\s*-not\s*\$digestOk\)/);
    expect(step).toMatch(/\$failed\s*=\s*\$true/);
  });

  // Regression: the previous version wrote a Write-Warn and moved on
  // (never setting $failed) whenever the target group couldn't be
  // resolved by name — silently passing verification with no ALB health
  // check performed at all.
  it("fails the workflow, never warns-and-skips, when the ALB target group cannot be resolved", () => {
    const step = extractStep(workflow, 'Write-Step "Verifying ALB target health"', 'Write-Step "Scanning recent web/worker logs');
    expect(step).not.toMatch(/Write-Warn/);
    expect(step).toMatch(/if\s*\(-not\s*\$tgArn\)\s*\{\s*\n\s*Write-Fail[\s\S]*?\$failed\s*=\s*\$true/);
  });

  it("fails the workflow, never warns-and-skips, when describe-target-health errors or returns no data", () => {
    const step = extractStep(workflow, 'Write-Step "Verifying ALB target health"', 'Write-Step "Scanning recent web/worker logs');
    expect(step).toMatch(/catch\s*\{\s*\$health\s*=\s*\$null\s*\}/);
    expect(step).toMatch(/if\s*\(-not\s*\$health\s*-or\s*-not\s*\$health\.TargetHealthDescriptions\)\s*\{[\s\S]*?\$failed\s*=\s*\$true/);
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
