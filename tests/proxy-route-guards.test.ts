import { describe, it, expect } from "vitest";
import { isPublicRoute, isFounderRoute, isFounderApiRoute, isStudentRoute } from "@/proxy";

describe("proxy route classification — founder and student areas are gated independently of the general school-staff gate", () => {
  it("treats /login, /founder/login and /student/login as public (no session required to view them)", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/founder/login")).toBe(true);
    expect(isPublicRoute("/student/login")).toBe(true);
  });

  it("does NOT treat authenticated portal roots as public", () => {
    expect(isPublicRoute("/founder/dashboard")).toBe(false);
    expect(isPublicRoute("/student/dashboard")).toBe(false);
    expect(isPublicRoute("/dashboard/school-one")).toBe(false);
  });

  it("classifies every /founder/* page except /founder/login as a Founder-gated route", () => {
    expect(isFounderRoute("/founder")).toBe(true);
    expect(isFounderRoute("/founder/dashboard")).toBe(true);
    expect(isFounderRoute("/founder/schools")).toBe(true);
    expect(isFounderRoute("/founder/login")).toBe(false);
  });

  it("does not classify school-staff or student pages as Founder routes", () => {
    expect(isFounderRoute("/dashboard/school-one")).toBe(false);
    expect(isFounderRoute("/teacher/attendance")).toBe(false);
    expect(isFounderRoute("/student/dashboard")).toBe(false);
    expect(isFounderRoute("/login")).toBe(false);
  });

  it("classifies every /api/founder/* route as a Founder-gated API route", () => {
    expect(isFounderApiRoute("/api/founder/schools")).toBe(true);
    expect(isFounderApiRoute("/api/schools/s1")).toBe(false);
  });

  it("classifies every /student/* page except /student/login as a Student-gated route", () => {
    expect(isStudentRoute("/student")).toBe(true);
    expect(isStudentRoute("/student/dashboard")).toBe(true);
    expect(isStudentRoute("/student/login")).toBe(false);
  });

  it("does not classify staff or founder pages as Student routes", () => {
    expect(isStudentRoute("/dashboard/school-one")).toBe(false);
    expect(isStudentRoute("/founder/dashboard")).toBe(false);
    expect(isStudentRoute("/login")).toBe(false);
  });
});
