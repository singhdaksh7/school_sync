import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This repo has no component/DOM test harness (no jsdom, no
// @testing-library/react in devDependencies) — every other test in tests/
// exercises Node-side logic directly. In that spirit, this is a structural
// source check rather than a rendered-DOM assertion: it pins the literal
// requirement ("no role selector on the unified school login page", "role
// is never sent by the client") in an automatable way without adding new
// test infrastructure.
function readSource(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf-8");
}

describe("unified /login page — no role selection, role never sent by the client", () => {
  const source = readSource("src/app/login/page.tsx");

  it("has exactly one credential form (one email/identifier field, one password field)", () => {
    expect(source.match(/type="password"/g)?.length).toBe(1);
  });

  it("never passes a role field into signIn()", () => {
    expect(source).not.toContain("role:");
    expect(source).not.toContain("role=");
  });

  it("does not contain role-labeled selection UI (Admin/Principal/Faculty/Founder/Student buttons or tabs)", () => {
    for (const roleWord of ["Admin Login", "Principal Login", "Faculty Login", "Founder Login", "Student Login"]) {
      expect(source).not.toContain(roleWord);
    }
  });

  it("resolves which provider to call from the identifier's format, not a role field", () => {
    expect(source).toContain("detectLoginIdentifierKind");
  });

  it("shows one generic error for every failure code — never branches on result.code", () => {
    expect(source).not.toMatch(/result\.code/);
    expect(source).not.toContain("no-account");
    expect(source).not.toContain("invalid-password");
  });
});

describe("/founder/login page — same generic-error rule, and no client-side role re-check", () => {
  const source = readSource("src/app/founder/login/page.tsx");

  it("shows one generic error for every failure code — never branches on result.code", () => {
    expect(source).not.toMatch(/result\.code/);
  });

  it("no longer performs a post-login session role check / signOut (server rejects non-Founder credentials before a session ever exists)", () => {
    expect(source).not.toContain("notFounderAccount");
  });

  it("uses the dedicated founder-only provider, not the shared staff provider", () => {
    expect(source).toContain('signIn("founder-credentials"');
  });
});

describe("/student/login — kept as a backward-compatible redirect, not deleted", () => {
  it("forwards to the unified /login instead of 404ing", () => {
    const source = readSource("src/app/student/login/page.tsx");
    expect(source).toContain('redirect("/login")');
  });
});

describe("landing page — school sign-in is a single entry point, Founder access is present but not a peer role option", () => {
  const source = readSource("src/app/page.tsx");

  it("no longer shows separate Admin/Principal/Faculty/Student role cards", () => {
    for (const roleKey of ["landing.adminLogin", "landing.principalLogin", "landing.facultyLogin", "landing.studentLogin"]) {
      expect(source).not.toContain(`t("${roleKey}")`);
    }
  });

  it("still links to /login exactly once as the school sign-in entry point", () => {
    expect(source.match(/href="\/login"/g)?.length).toBe(1);
  });
});
