import { NextResponse } from "next/server";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { handleMarkAllNotificationsRead } from "@/lib/notification-routes";

export async function PATCH(req: Request) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await requireSchoolFeature(auth.schoolId, "NOTIFICATIONS");
  if (denied) return denied;

  return handleMarkAllNotificationsRead(auth.schoolId, { recipientType: "STUDENT", recipientId: auth.studentId });
}
