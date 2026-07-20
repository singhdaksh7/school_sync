/**
 * Thin, shared HTTP glue for the four per-role notification route surfaces
 * (teacher/student/parent/admin) — every route.ts resolves its own
 * authenticated recipient (never trusting a client-supplied one) and then
 * delegates to these handlers, so list/unread-count/mark-read/mark-all-read
 * behavior can never drift between roles.
 */
import { NextResponse } from "next/server";
import { listNotificationsForRecipient, unreadNotificationCount, markNotificationRead, markAllNotificationsRead, type RecipientRef } from "@/lib/notification-queries";

export async function handleListNotifications(req: Request, schoolId: string, recipient: RecipientRef) {
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const cursor = searchParams.get("cursor");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limitParam && (!Number.isFinite(limit) || (limit as number) < 1)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }
  const result = await listNotificationsForRecipient({ schoolId, recipient, unreadOnly, cursor, limit });
  return NextResponse.json(result);
}

export async function handleUnreadCount(schoolId: string, recipient: RecipientRef) {
  const unreadCount = await unreadNotificationCount(schoolId, recipient);
  return NextResponse.json({ unreadCount });
}

export async function handleMarkNotificationRead(schoolId: string, recipient: RecipientRef, notificationId: string) {
  const result = await markNotificationRead(schoolId, recipient, notificationId);
  if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function handleMarkAllNotificationsRead(schoolId: string, recipient: RecipientRef) {
  const result = await markAllNotificationsRead(schoolId, recipient);
  return NextResponse.json({ success: true, count: result.count });
}
