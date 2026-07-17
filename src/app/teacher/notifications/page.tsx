"use client";

import NotificationsPageContent from "@/components/notifications/NotificationsPageContent";

export default function TeacherNotificationsPage() {
  return <NotificationsPageContent role="teacher" basePath="/api/teacher/notifications" rolePrefix="/teacher" />;
}
