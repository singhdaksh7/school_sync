import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDatabaseSsl } from "@/lib/prisma";

/**
 * Regression coverage for the RDS TLS fix: src/lib/prisma.ts must never
 * disable certificate verification for a non-local Postgres connection.
 * The previous `ssl: { rejectUnauthorized: false }` was also, per
 * node-postgres's documented behavior, silently ineffective in production
 * (DATABASE_URL's sslmode replaces rather than merges with an explicit
 * `ssl` object) — which is the actual root cause this guards against, not
 * just the insecure-looking literal.
 */

describe("resolveDatabaseSsl (src/lib/prisma.ts)", () => {
  it("returns false for localhost — local dev has no TLS listener", () => {
    expect(resolveDatabaseSsl("postgresql://user:pass@localhost:5432/db")).toBe(false);
  });

  it("returns false for 127.0.0.1", () => {
    expect(resolveDatabaseSsl("postgresql://user:pass@127.0.0.1:5432/db")).toBe(false);
  });

  it("returns undefined (no ssl override) for a non-local host, e.g. RDS", () => {
    const result = resolveDatabaseSsl("postgresql://user:pass@schoolsync-staging-pg.abc123.ap-south-1.rds.amazonaws.com:5432/db?sslmode=verify-full");
    expect(result).toBeUndefined();
  });

  it("never returns an object that disables certificate verification", () => {
    const hosts = ["localhost", "127.0.0.1", "some-managed-host.rds.amazonaws.com", "db.example.com"];
    for (const host of hosts) {
      const result = resolveDatabaseSsl(`postgresql://user:pass@${host}:5432/db`);
      // The only two legal return values are `false` (TLS off, localhost
      // only) and `undefined` (defer entirely to the connection string's
      // own sslmode). Neither can carry rejectUnauthorized:false or any
      // other verification bypass.
      expect(result === false || result === undefined).toBe(true);
      if (typeof result === "object") {
        throw new Error("resolveDatabaseSsl must never return an ssl config object");
      }
    }
  });
});

describe("src/lib/prisma.ts contains no certificate-verification bypass", () => {
  const source = () => readFileSync(join(process.cwd(), "src", "lib", "prisma.ts"), "utf-8");

  it("does not contain rejectUnauthorized: false", () => {
    expect(source()).not.toMatch(/rejectUnauthorized\s*:\s*false/);
  });

  it("does not contain any other TLS-bypass pattern", () => {
    const bypassPatterns = [/NODE_TLS_REJECT_UNAUTHORIZED/, /sslmode\s*=\s*no-verify/i, /sslmode\s*=\s*disable/i, /checkServerIdentity/];
    for (const pattern of bypassPatterns) {
      expect(source()).not.toMatch(pattern);
    }
  });

  it("the non-local branch never sets an ssl object with rejectUnauthorized (comment doesn't claim the Pool ssl object overrides sslmode)", () => {
    // Guards against the specific misleading-comment failure mode: the file
    // must not claim the explicit `ssl` object on Pool takes precedence
    // over the connection string's sslmode — that's the opposite of
    // node-postgres's actual, documented behavior.
    expect(source()).not.toMatch(/ssl.{0,40}overrides?.{0,20}sslmode/i);
  });
});
