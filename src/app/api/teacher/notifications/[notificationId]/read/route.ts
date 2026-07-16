import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { handleMarkNotificationRead } from "@/lib/notification-routes";

export async function PATCH(req: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  const { notificationId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await requireSchoolFeature(teacherAuth.schoolId, "NOTIFICATIONS");
  if (denied) return denied;

  return handleMarkNotificationRead(teacherAuth.schoolId, { recipientType: "TEACHER", recipientId: teacherAuth.teacherId }, notificationId);
}
