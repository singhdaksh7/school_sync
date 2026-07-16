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

  it("every new unified-notification-center key exists in both locales", () => {
    const newKeys = [
      "notifications.title",
      "notifications.markAllRead",
      "notifications.loadError",
      "notifications.empty",
      "notifications.viewAll",
      "notifications.showAll",
      "notifications.showingUnread",
      "notifications.loadMore",
      "notifications.time.justNow",
      "notifications.time.minutesAgo",
      "notifications.time.hoursAgo",
      "notifications.time.daysAgo",
      "notifications.events.HOMEWORK_PUBLISHED",
      "notifications.events.HOMEWORK_UPDATED",
      "notifications.events.ANNOUNCEMENT_PUBLISHED",
      "notifications.events.ANNOUNCEMENT_CORRECTED",
      "notifications.events.ATTENDANCE_ABSENT",
      "notifications.events.ATTENDANCE_LATE",
      "notifications.events.ATTENDANCE_ON_LEAVE",
      "notifications.events.ATTENDANCE_CORRECTED",
      "notifications.events.STUDENT_LEAVE_APPROVED",
      "notifications.events.STUDENT_LEAVE_REJECTED",
      "notifications.events.TEACHER_LEAVE_APPROVED",
      "notifications.events.TEACHER_LEAVE_REJECTED",
      "notifications.events.EARLY_LEAVE_APPROVED",
      "notifications.events.EARLY_LEAVE_REJECTED",
      "notifications.events.LEAVE_PENDING_REVIEW",
      "notifications.events.ATTENDANCE_CORRECTION_PENDING_REVIEW",
      "notifications.events.ATTENDANCE_RECONCILIATION_NEEDED",
    ];
    const enKeys = new Set(collectKeyPaths(en));
    const hiKeys = new Set(collectKeyPaths(hi));
    for (const key of newKeys) {
      expect(enKeys.has(key), `en.json missing ${key}`).toBe(true);
      expect(hiKeys.has(key), `hi.json missing ${key}`).toBe(true);
    }
  });
});
