import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Validates the vendored AWS RDS CA bundle (certs/aws-rds-global-bundle.pem)
 * that Node trusts via NODE_EXTRA_CA_CERTS (see infra/terraform/ecs.tf and
 * src/lib/prisma.ts) instead of disabling certificate verification. This
 * file must always be exactly what AWS publishes at
 * https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem — never
 * hand-edited — so these checks are structural/provenance checks, not a
 * content diff.
 */

const ROOT = process.cwd();
const BUNDLE_PATH = join(ROOT, "certs", "aws-rds-global-bundle.pem");
const README_PATH = join(ROOT, "certs", "README.md");

describe("vendored AWS RDS CA bundle (certs/aws-rds-global-bundle.pem)", () => {
  it("exists and is non-empty", () => {
    const content = readFileSync(BUNDLE_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("contains one or more CERTIFICATE blocks", () => {
    const content = readFileSync(BUNDLE_PATH, "utf-8");
    const matches = content.match(/-----BEGIN CERTIFICATE-----/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
  });

  it("contains no PRIVATE KEY block of any kind", () => {
    const content = readFileSync(BUNDLE_PATH, "utf-8");
    expect(content).not.toMatch(/PRIVATE KEY/);
  });

  it("contains the root CA for this deployment's RDS CACertificateIdentifier (rds-ca-rsa2048-g1, ap-south-1)", () => {
    // The bundle is base64-encoded DER, so the human-readable subject only
    // appears once OpenSSL decodes it — grepping the raw file would always
    // find nothing here, regardless of whether the CA is actually present.
    const output = execFileSync("openssl", ["storeutl", "-noout", "-text", "-certs", BUNDLE_PATH], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toMatch(/Amazon RDS ap-south-1 Root CA RSA2048 G1/);
  });

  it("certs/README.md documents the source URL, retrieval date, and SHA-256", () => {
    const readme = readFileSync(README_PATH, "utf-8");
    expect(readme).toMatch(/https:\/\/truststore\.pki\.rds\.amazonaws\.com\/global\/global-bundle\.pem/);
    expect(readme).toMatch(/Retrieved:\s*\d{4}-\d{2}-\d{2}/);
    expect(readme).toMatch(/SHA-256:\s*`[0-9a-f]{64}`/);
  });

  it("the documented SHA-256 matches the actual file", async () => {
    const { createHash } = await import("node:crypto");
    const content = readFileSync(BUNDLE_PATH);
    const actual = createHash("sha256").update(content).digest("hex");
    const readme = readFileSync(README_PATH, "utf-8");
    const documented = readme.match(/SHA-256:\s*`([0-9a-f]{64})`/)?.[1];
    expect(documented).toBe(actual);
  });

  it("every certificate in the bundle parses with OpenSSL", () => {
    // openssl storeutl -noout -text validates and parses every certificate
    // in a multi-cert PEM file without printing key material (there is
    // none — the previous test already confirmed no PRIVATE KEY block).
    let output: string;
    try {
      output = execFileSync("openssl", ["storeutl", "-noout", "-text", "-certs", BUNDLE_PATH], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      throw new Error(`openssl failed to parse certs/aws-rds-global-bundle.pem: ${(err as Error).message}`);
    }
    // Every successfully-parsed cert is echoed back with its Subject line.
    const subjectCount = (output.match(/Subject:/g) ?? []).length;
    const certCount = (readFileSync(BUNDLE_PATH, "utf-8").match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
    expect(subjectCount).toBe(certCount);
  });
});
