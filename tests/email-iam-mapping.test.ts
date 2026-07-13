import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * Statically verifies which ECS task types can send email, and that SES IAM
 * permissions are granted ONLY to those task roles.
 *
 * Email is sent exclusively via src/lib/email.ts's sendPasswordResetEmail /
 * sendStaffInviteEmail, both called only from Next.js API routes (src/app) —
 * i.e. only in-process in the web app. Neither the worker (scripts/worker.ts,
 * which only makes authenticated HTTP calls to the web service's internal
 * endpoint) nor the migration task (`npx prisma migrate deploy`, no
 * application code at all) ever imports src/lib/email.ts.
 */

const ROOT = process.cwd();

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "graphify-out" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, exts, out);
    else if (exts.includes(extname(entry))) out.push(full);
  }
  return out;
}

describe("email call sites are confined to the web app", () => {
  it("scripts/ (the worker + one-off ops scripts) never imports src/lib/email.ts", () => {
    const scriptFiles = walk(join(ROOT, "scripts"), [".ts"]);
    expect(scriptFiles.length).toBeGreaterThan(0);
    for (const file of scriptFiles) {
      const source = readFileSync(file, "utf-8");
      expect(source).not.toMatch(/@\/lib\/email/);
      expect(source).not.toMatch(/sendPasswordResetEmail|sendStaffInviteEmail/);
    }
  });

  it("scripts/worker.ts (the standalone worker process) makes no reference to email at all", () => {
    const source = readFileSync(join(ROOT, "scripts", "worker.ts"), "utf-8");
    expect(source.toLowerCase()).not.toContain("email");
  });

  it("the migration path (prisma migrate deploy, invoked only via infra/scripts/run-migrations.ps1) runs no application code, so it cannot send email", () => {
    const migrateScript = readFileSync(join(ROOT, "infra", "scripts", "run-migrations.ps1"), "utf-8");
    expect(migrateScript).toMatch(/prisma migrate deploy/);
    expect(migrateScript.toLowerCase()).not.toContain("email");
  });

  it("every call site of the email-sending functions lives under src/app (the Next.js web app)", () => {
    const appFiles = walk(join(ROOT, "src", "app"), [".ts", ".tsx"]);
    const libFiles = walk(join(ROOT, "src", "lib"), [".ts"]).filter((f) => !f.endsWith(join("src", "lib", "email.ts")));
    const candidateFiles = [...appFiles, ...libFiles];

    const callers = candidateFiles.filter((file) => {
      const source = readFileSync(file, "utf-8");
      return /sendPasswordResetEmail\(|sendStaffInviteEmail\(/.test(source);
    });

    expect(callers.length).toBeGreaterThan(0); // sanity: the search itself actually finds real call sites
    for (const file of callers) {
      expect(file).toContain(join("src", "app"));
    }
  });
});

describe("SES IAM permission mapping (infra/terraform)", () => {
  const tf = (name: string) => readFileSync(join(ROOT, "infra", "terraform", name), "utf-8");

  it("ses.tf grants ses:SendEmail/SendRawEmail to the web task role only", () => {
    const ses = tf("ses.tf");
    const policyBlock = ses.match(/resource "aws_iam_role_policy" "web_ses"[\s\S]*?\n}/);
    expect(policyBlock).not.toBeNull();
    expect(policyBlock![0]).toMatch(/role\s*=\s*aws_iam_role\.ecs_task_web\.id/);
    // No SES policy resource anywhere targets the minimal (worker/migrate) role.
    expect(ses).not.toMatch(/aws_iam_role_policy["'].*[\s\S]*?ecs_task_minimal/);
  });

  it("iam.tf attaches no policy at all to ecs_task_minimal (the worker + migrate role)", () => {
    const iam = tf("iam.tf");
    // Only two roles are declared in iam.tf: ecs_task_web and ecs_task_minimal.
    expect(iam).toMatch(/resource "aws_iam_role" "ecs_task_minimal"/);
    // No aws_iam_role_policy / aws_iam_role_policy_attachment resource in the
    // whole terraform config may reference ecs_task_minimal — it must stay
    // trust-relationship-only (no SES, no S3, nothing).
    const allTfFiles = readdirSync(join(ROOT, "infra", "terraform")).filter((f) => f.endsWith(".tf"));
    for (const file of allTfFiles) {
      const content = tf(file);
      const policyResources = content.match(/resource\s+"aws_iam_role_policy(?:_attachment)?"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g) ?? [];
      for (const block of policyResources) {
        expect(block).not.toMatch(/ecs_task_minimal/);
      }
    }
  });

  it("s3.tf (storage) also scopes its policy to the web task role only, not the minimal role", () => {
    const s3 = tf("s3.tf");
    const policyBlock = s3.match(/resource "aws_iam_role_policy" "web_storage"[\s\S]*?\n}/);
    expect(policyBlock).not.toBeNull();
    expect(policyBlock![0]).toMatch(/role\s*=\s*aws_iam_role\.ecs_task_web\.id/);
  });

  it("ecs.tf assigns ecs_task_web to the web service and ecs_task_minimal to worker + migrate", () => {
    const ecs = tf("ecs.tf");
    const webTaskDef = ecs.match(/resource "aws_ecs_task_definition" "web"[\s\S]*?\n}\n/);
    const workerTaskDef = ecs.match(/resource "aws_ecs_task_definition" "worker"[\s\S]*?\n}\n/);
    const migrateTaskDef = ecs.match(/resource "aws_ecs_task_definition" "migrate"[\s\S]*?\n}\n/);
    expect(webTaskDef![0]).toMatch(/task_role_arn\s*=\s*aws_iam_role\.ecs_task_web\.arn/);
    expect(workerTaskDef![0]).toMatch(/task_role_arn\s*=\s*aws_iam_role\.ecs_task_minimal\.arn/);
    expect(migrateTaskDef![0]).toMatch(/task_role_arn\s*=\s*aws_iam_role\.ecs_task_minimal\.arn/);
  });

  it("only the web task's container environment sets EMAIL_PROVIDER — worker and migrate never receive email config", () => {
    const ecs = tf("ecs.tf");
    // The web task definition references local.web_environment (defined in
    // the preceding `locals` block) rather than inlining the array, so check
    // that local's definition specifically, not the resource block's text.
    const webEnvironmentLocal = ecs.match(/web_environment = concat\(([\s\S]*?)\n  \)\n}/)![0];
    const workerTaskDef = ecs.match(/resource "aws_ecs_task_definition" "worker"[\s\S]*?\n}\n/)![0];
    const migrateTaskDef = ecs.match(/resource "aws_ecs_task_definition" "migrate"[\s\S]*?\n}\n/)![0];

    expect(webEnvironmentLocal).toMatch(/EMAIL_PROVIDER/);
    expect(workerTaskDef).not.toMatch(/EMAIL_PROVIDER|RESEND_API_KEY|EMAIL_FROM/);
    expect(migrateTaskDef).not.toMatch(/EMAIL_PROVIDER|RESEND_API_KEY|EMAIL_FROM/);
  });
});
