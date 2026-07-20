import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { handleListNotifications } from "@/lib/notification-routes";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await requireSchoolFeature(teacherAuth.schoolId, "NOTIFICATIONS");
  if (denied) return denied;

  return handleListNotifications(req, teacherAuth.schoolId, { recipientType: "TEACHER", recipientId: teacherAuth.teacherId });
}
