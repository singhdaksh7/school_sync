import { describe, it, expect } from "vitest";
import { resolveRedirectPath } from "@/lib/auth-redirect";

describe("resolveRedirectPath — server-resolved role decides the destination, never the client", () => {
  it("sends an unauthenticated request to /login", () => {
    expect(resolveRedirectPath(null)).toBe("/login");
    expect(resolveRedirectPath(undefined)).toBe("/login");
  });

  it("sends FOUNDER to the founder dashboard", () => {
    expect(resolveRedirectPath({ role: "FOUNDER" })).toBe("/founder/dashboard");
  });

  it("sends STUDENT to the student dashboard", () => {
    expect(resolveRedirectPath({ role: "STUDENT" })).toBe("/student/dashboard");
  });

  it("sends TEACHER to the teacher portal", () => {
    expect(resolveRedirectPath({ role: "TEACHER", schoolSlug: "school-one" })).toBe("/teacher/attendance");
  });

  it("sends SCHOOL_OWNER to their tenant dashboard by slug", () => {
    expect(resolveRedirectPath({ role: "SCHOOL_OWNER", schoolSlug: "school-one" })).toBe("/dashboard/school-one");
  });

  it("sends SCHOOL_ADMIN to their tenant dashboard by slug", () => {
    expect(resolveRedirectPath({ role: "SCHOOL_ADMIN", schoolSlug: "school-two" })).toBe("/dashboard/school-two");
  });

  it("sends VICE_PRINCIPAL to their tenant dashboard by slug (same admin-style portal)", () => {
    expect(resolveRedirectPath({ role: "VICE_PRINCIPAL", schoolSlug: "school-two" })).toBe("/dashboard/school-two");
  });

  it("sends an account with no resolvable school to /no-school", () => {
    expect(resolveRedirectPath({ role: "SCHOOL_ADMIN", schoolSlug: null })).toBe("/no-school");
  });
});
