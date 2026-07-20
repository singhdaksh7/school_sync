import { describe, it, expect } from "vitest";
import en from "@locales/en.json";
import hi from "@locales/hi.json";

function collectKeyPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeyPaths(value, prefix ? `${prefix}.${key}` : key)
  );
}

describe("locale structural consistency (en.json vs hi.json)", () => {
  it("has no keys present in en.json but missing from hi.json", () => {
    const enKeys = new Set(collectKeyPaths(en));
    const hiKeys = new Set(collectKeyPaths(hi));
    const missing = [...enKeys].filter((k) => !hiKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("has no keys present in hi.json but missing from en.json", () => {
    const enKeys = new Set(collectKeyPaths(en));
    const hiKeys = new Set(collectKeyPaths(hi));
    const missing = [...hiKeys].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("every new attendance-v2 / parentLeave key exists in both locales", () => {
    const newKeys = [
      "common.retry",
      "nav.parentPortal",
      "teacherAttendance.onLeave",
      "teacherAttendance.sessionLocked",
      "teacherAttendance.saveDraft",
      "teacherAttendance.submitAttendance",
      "teacherAttendance.confirmSubmitTitle",
      "teacherAttendance.requestCorrection",
      "teacherAttendance.correctionRequestsTitle",
      "parentLeave.title",
      "parentLeave.childSelector",
      "parentLeave.loginTitle",
      "parentLeave.cutoffExplanation",
    ];
    const enKeys = new Set(collectKeyPaths(en));
    const hiKeys = new Set(collectKeyPaths(hi));
    for (const key of newKeys) {
      expect(enKeys.has(key), `en.json missing ${key}`).toBe(true);
      expect(hiKeys.has(key), `hi.json missing ${key}`).toBe(true);
    }
  });
});
