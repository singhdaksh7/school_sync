import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression coverage for the runtime-vs-CLI TLS split (RDS TLS fix): the
 * app runtime (DATABASE_URL, consumed by src/lib/prisma.ts via
 * @prisma/adapter-pg) and the Prisma CLI/schema-engine (DIRECT_URL, see
 * prisma.config.ts) intentionally use different sslmode values —
 * `verify-full` for the runtime (fully verified, trusting the vendored RDS
 * CA via NODE_EXTRA_CA_CERTS) and `require` for the CLI (already confirmed
 * working live; verify-full is undocumented for the schema-engine and not
 * worth risking a migration outage over).
 *
 * These tests assert only parameter *names* and *modes* — never render or
 * inspect the interpolated secret values (random_password results,
 * aws_db_instance.main.address, etc.) — matching the constraint that no
 * generated credential may be printed or asserted against.
 */

const ROOT = process.cwd();
const secrets = () => readFileSync(join(ROOT, "infra", "terraform", "secrets.tf"), "utf-8");

describe("DATABASE_URL / DIRECT_URL sslmode split (infra/terraform/secrets.tf)", () => {
  it("defines a shared base URL with no sslmode baked in (only user/password/host/port/dbname)", () => {
    const match = secrets().match(/db_url_base\s*=\s*"([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/sslmode/);
    expect(match![1]).toMatch(/^postgresql:\/\//);
  });

  it("db_url_runtime appends sslmode=verify-full", () => {
    const match = secrets().match(/db_url_runtime\s*=\s*"([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/\$\{local\.db_url_base\}\?sslmode=verify-full/);
  });

  it("db_url_cli appends sslmode=require", () => {
    const match = secrets().match(/db_url_cli\s*=\s*"([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/\$\{local\.db_url_base\}\?sslmode=require/);
  });

  it("DATABASE_URL (app runtime) maps to db_url_runtime, not db_url_cli", () => {
    const mapBlock = secrets().match(/app_secret_map = \{[\s\S]*?\r?\n  \}/)![0];
    expect(mapBlock).toMatch(/DATABASE_URL\s*=\s*local\.db_url_runtime/);
  });

  it("DIRECT_URL (Prisma CLI) maps to db_url_cli, not db_url_runtime", () => {
    const mapBlock = secrets().match(/app_secret_map = \{[\s\S]*?\r?\n  \}/)![0];
    expect(mapBlock).toMatch(/DIRECT_URL\s*=\s*local\.db_url_cli/);
  });

  it("DATABASE_URL and DIRECT_URL are not both set to the same local value (the old, now-fixed shared db_url)", () => {
    const mapBlock = secrets().match(/app_secret_map = \{[\s\S]*?\r?\n  \}/)![0];
    const databaseUrlValue = mapBlock.match(/DATABASE_URL\s*=\s*(\S+)/)?.[1];
    const directUrlValue = mapBlock.match(/DIRECT_URL\s*=\s*(\S+)/)?.[1];
    expect(databaseUrlValue).not.toBe(directUrlValue);
  });

  it("no plaintext credential, password, or connection string literal appears in the diff surface checked here", () => {
    // Sanity: these tests only ever read local *names* and static sslmode
    // literals — never `random_password.*.result` interpolation output,
    // which Terraform never renders to disk anyway outside of state.
    const content = secrets();
    expect(content).not.toMatch(/postgresql:\/\/[^$][^"]*:[^"]*@/); // no literal (non-interpolated) credentials
  });
});

describe("prisma.config.ts consumes DIRECT_URL (falling back to DATABASE_URL)", () => {
  it("datasource.url resolves DIRECT_URL first", () => {
    const config = readFileSync(join(ROOT, "prisma.config.ts"), "utf-8");
    expect(config).toMatch(/url:\s*process\.env\.DIRECT_URL\s*\?\?\s*env\("DATABASE_URL"\)/);
  });
});
