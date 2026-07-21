import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { handleMarkAllNotificationsRead } from "@/lib/notification-routes";

export async function PATCH(req: NextRequest) {
  const authResult = await getAuthenticatedGuardian(req);
  if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await requireSchoolFeature(authResult.guardian.schoolId, "NOTIFICATIONS");
  if (denied) return denied;

  return handleMarkAllNotificationsRead(authResult.guardian.schoolId, { recipientType: "GUARDIAN", recipientId: authResult.guardian.id });
}
