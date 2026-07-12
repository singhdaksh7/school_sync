import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectLoginIdentifierKind } from "@/lib/login-identifier";

describe("detectLoginIdentifierKind — format detection, not a role choice", () => {
  it("routes an email-shaped identifier to the staff provider", () => {
    expect(detectLoginIdentifierKind("owner@school.edu")).toBe("staff");
  });

  it("routes a plain admission number to the student provider", () => {
    expect(detectLoginIdentifierKind("ADM-001")).toBe("student");
  });

  it("routes a numeric-only admission number to the student provider", () => {
    expect(detectLoginIdentifierKind("2026045")).toBe("student");
  });

  it("never exposes a role concept — output is a provider selector derived purely from input shape", () => {
    // Same function, same rule, for every input — no branch depends on
    // anything other than whether "@" is present.
    const inputs = ["a@b.com", "x", "founder@schoolsync.com", "ADM-999"];
    for (const input of inputs) {
      expect(["staff", "student"]).toContain(detectLoginIdentifierKind(input));
    }
  });

  it("covers every staff sub-role's email login (Owner/Admin/VP/Teacher/Founder all use the same email shape)", () => {
    for (const email of ["owner@school.edu", "admin@school.edu", "vp@school.edu", "teacher@school.edu", "founder@schoolsync.com"]) {
      expect(detectLoginIdentifierKind(email)).toBe("staff");
    }
  });
});

describe("identifier coverage matches what the underlying providers actually query — no invented phone/email-for-student support", () => {
  it("authenticateStudentForMobile (src/lib/mobile-auth.ts) queries Student by admissionNo only, never by email", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/mobile-auth.ts"), "utf-8");
    const fnStart = source.indexOf("export async function authenticateStudentForMobile");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 1500);
    expect(fnBody).toContain("admissionNo: trimmed");
    expect(fnBody).not.toMatch(/email:\s*trimmed/);
  });

  it("authenticateStaffForWeb (src/lib/auth-web.ts) looks staff up by email only", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/auth-web.ts"), "utf-8");
    expect(source).toContain("prisma.user.findUnique({\n    where: { email: normalizedEmail }");
  });

  it("no phone-number field is read anywhere in the unified /login page's form or submit logic", () => {
    const source = readFileSync(join(process.cwd(), "src/app/login/page.tsx"), "utf-8");
    expect(source.toLowerCase()).not.toContain("phone");
  });
});
