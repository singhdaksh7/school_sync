import { describe, it, expect } from "vitest";
import { validateStudentLeaveDateRange, sameDayCutoffPassed } from "@/lib/student-leave-rules";

describe("validateStudentLeaveDateRange — shared by /api/student/leave and /api/parent/leave", () => {
  it("rejects a past fromDate", () => {
    const result = validateStudentLeaveDateRange("2020-01-01", "2020-01-02", new Date("2026-01-05T10:00:00"));
    expect(result).toMatchObject({ ok: false, error: "Cannot request leave for a past date" });
  });

  it("rejects toDate before fromDate", () => {
    const result = validateStudentLeaveDateRange("2026-02-02", "2026-02-01", new Date("2026-01-05T10:00:00"));
    expect(result).toMatchObject({ ok: false, error: "To date must be on or after from date" });
  });

  it("rejects an invalid date string", () => {
    const result = validateStudentLeaveDateRange("not-a-date", "2026-02-01", new Date("2026-01-05T10:00:00"));
    expect(result).toMatchObject({ ok: false, error: "Invalid date" });
  });

  it("blocks same-day leave after the 7:30 AM cutoff", () => {
    const now = new Date("2026-01-05T08:00:00");
    const result = validateStudentLeaveDateRange("2026-01-05", "2026-01-05", now);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("7:30 AM") });
  });

  it("allows same-day leave before the 7:30 AM cutoff", () => {
    const now = new Date("2026-01-05T07:00:00");
    const result = validateStudentLeaveDateRange("2026-01-05", "2026-01-05", now);
    expect(result.ok).toBe(true);
  });

  it("allows a future date regardless of the time of day", () => {
    const now = new Date("2026-01-05T23:00:00");
    const result = validateStudentLeaveDateRange("2026-01-06", "2026-01-07", now);
    expect(result.ok).toBe(true);
  });
});

describe("sameDayCutoffPassed", () => {
  it("is false before 7:30", () => {
    expect(sameDayCutoffPassed(new Date("2026-01-05T07:29:59"))).toBe(false);
  });
  it("is true at exactly 7:30", () => {
    expect(sameDayCutoffPassed(new Date("2026-01-05T07:30:00"))).toBe(true);
  });
  it("is true after 7:30", () => {
    expect(sameDayCutoffPassed(new Date("2026-01-05T08:00:00"))).toBe(true);
  });
});
