import { describe, it, expect } from "vitest";
import { isUnlimited, withinStudentLimit } from "@/lib/plan-limits";

describe("plan student-limit logic", () => {
  it("treats null/undefined maxStudents as unlimited", () => {
    expect(isUnlimited(null)).toBe(true);
    expect(isUnlimited(undefined)).toBe(true);
    expect(isUnlimited(200)).toBe(false);
    expect(withinStudentLimit(10_000, 5, null)).toBe(true);
  });

  it("permits adds up to the cap and rejects overflow", () => {
    expect(withinStudentLimit(199, 1, 200)).toBe(true); // fills to exactly 200
    expect(withinStudentLimit(200, 1, 200)).toBe(false); // at cap → reject
    expect(withinStudentLimit(198, 3, 200)).toBe(false); // bulk overflow (201)
    expect(withinStudentLimit(197, 3, 200)).toBe(true); // bulk fits (200)
  });
});
