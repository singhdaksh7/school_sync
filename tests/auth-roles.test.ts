import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAFF_ROLES } from "@/lib/auth-roles";

describe("STAFF_ROLES — shared staff role allowlist", () => {
  it("contains exactly the four school-staff roles", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["SCHOOL_ADMIN", "SCHOOL_OWNER", "TEACHER", "VICE_PRINCIPAL"].sort());
  });

  it("excludes FOUNDER and STUDENT — both have their own dedicated login paths", () => {
    expect(STAFF_ROLES.has("FOUNDER")).toBe(false);
    expect(STAFF_ROLES.has("STUDENT")).toBe(false);
  });
});

describe("src/lib/auth-roles.ts stays a dependency-free leaf module", () => {
  it("imports nothing from any auth provider, NextAuth config, or database module", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/auth-roles.ts"), "utf-8");
    const importLines = source.match(/^import .+$/gm) ?? [];
    for (const line of importLines) {
      expect(line).not.toMatch(/@\/lib\/auth(\.|-|")/); // auth.ts, auth.config.ts, auth-web.ts, auth-errors.ts, etc.
      expect(line).not.toMatch(/@\/lib\/mobile-auth/);
      expect(line).not.toMatch(/@\/lib\/prisma/);
    }
    // The file should have no import statements at all in its current form.
    expect(importLines.length).toBe(0);
  });
});
