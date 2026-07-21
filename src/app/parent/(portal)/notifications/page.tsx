"use client";

import NotificationsPageContent from "@/components/notifications/NotificationsPageContent";
import { useParentFetch } from "@/lib/parent-web-auth";

export default function ParentNotificationsPage() {
  const parentFetch = useParentFetch();
  return (
    <NotificationsPageContent
      role="parent"
      basePath="/api/parent/notifications"
      rolePrefix="/parent"
      fetchImpl={parentFetch as unknown as typeof fetch}
    />
  );
}
