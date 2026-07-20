"use client";

import NotificationsPageContent from "@/components/notifications/NotificationsPageContent";

export default function StudentNotificationsPage() {
  return <NotificationsPageContent role="student" basePath="/api/student/notifications" rolePrefix="/student" />;
}
