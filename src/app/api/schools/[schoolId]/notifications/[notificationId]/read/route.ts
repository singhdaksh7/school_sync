import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { handleMarkNotificationRead } from "@/lib/notification-routes";

export async function PATCH(_req: Request, { params }: { params: Promise<{ schoolId: string; notificationId: string }> }) {
  const { schoolId, notificationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = sessionRole(session.user);
  const access = await requireSchoolAccess(schoolId, session.user.id, role, "SETTINGS", "VIEW");
  if (!access.ok) return access.response;
  if (access.teacherId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const denied = await requireSchoolFeature(schoolId, "NOTIFICATIONS");
  if (denied) return denied;

  return handleMarkNotificationRead(schoolId, { recipientType: "ADMIN_STAFF", recipientId: session.user.id }, notificationId);
}
