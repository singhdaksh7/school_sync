/**
 * Client-side display mapping for notifications — translates a stable
 * `eventType` (+ minimal metadata) into a locale key and a safe, role-scoped
 * deep-link target. Never trusts `entityId` for anything beyond building a
 * link string; the destination page re-checks authorization itself (a
 * stale/inaccessible target renders that page's own empty/not-found state,
 * never a bypass).
 */
import type { LucideIcon } from "lucide-react";
import { BookOpen, Megaphone, CalendarClock, ClipboardCheck, ShieldAlert, CalendarX2 } from "lucide-react";

export type NotificationRole = "teacher" | "student" | "parent" | "admin";

export interface NotificationDisplayItem {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  readAt: string | null;
}

const EVENT_ICONS: Record<string, LucideIcon> = {
  HOMEWORK_PUBLISHED: BookOpen,
  HOMEWORK_UPDATED: BookOpen,
  ANNOUNCEMENT_PUBLISHED: Megaphone,
  ANNOUNCEMENT_CORRECTED: Megaphone,
  ATTENDANCE_ABSENT: ClipboardCheck,
  ATTENDANCE_LATE: ClipboardCheck,
  ATTENDANCE_ON_LEAVE: CalendarClock,
  ATTENDANCE_CORRECTED: ClipboardCheck,
  STUDENT_LEAVE_APPROVED: CalendarClock,
  STUDENT_LEAVE_REJECTED: CalendarX2,
  TEACHER_LEAVE_APPROVED: CalendarClock,
  TEACHER_LEAVE_REJECTED: CalendarX2,
  EARLY_LEAVE_APPROVED: CalendarClock,
  EARLY_LEAVE_REJECTED: CalendarX2,
  LEAVE_PENDING_REVIEW: ShieldAlert,
  ATTENDANCE_CORRECTION_PENDING_REVIEW: ShieldAlert,
  ATTENDANCE_RECONCILIATION_NEEDED: ShieldAlert,
};

export function notificationIcon(eventType: string): LucideIcon {
  return EVENT_ICONS[eventType] ?? Megaphone;
}

/** Locale key under `notifications.events.*` for this event type (see locales/en.json / hi.json). */
export function notificationLabelKey(eventType: string): string {
  return `notifications.events.${eventType}`;
}

/**
 * Safe, role-scoped destination for a notification — always an existing list
 * page (never a detail route that might not exist), so a stale/removed
 * entity just shows that page's own empty/not-found state. `rolePrefix` is
 * the actual URL root for this recipient's shell — "/teacher", "/student",
 * "/parent", or "/dashboard/<schoolSlug>" for an admin/operational user
 * (whose routes are keyed by school slug, not role).
 */
export function notificationDeepLink(role: NotificationRole, entityType: string, rolePrefix: string): string {
  switch (entityType) {
    case "Homework":
      return `${rolePrefix}/homework`;
    case "Announcement":
      return `${rolePrefix}/announcements`;
    case "AttendanceSession":
    case "AttendanceCorrectionRequest":
      return `${rolePrefix}/attendance`;
    case "LeaveRequest":
    case "TeacherEarlyLeaveRequest":
      return `${rolePrefix}/${role === "teacher" ? "leaves" : "leave"}`;
    default:
      return "";
  }
}

export function relativeTimeFromNow(iso: string): { key: "justNow" | "minutesAgo" | "hoursAgo" | "daysAgo"; value?: number } {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return { key: "justNow" };
  if (minutes < 60) return { key: "minutesAgo", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hoursAgo", value: hours };
  const days = Math.floor(hours / 24);
  return { key: "daysAgo", value: days };
}
