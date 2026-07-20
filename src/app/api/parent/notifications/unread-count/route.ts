import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { handleUnreadCount } from "@/lib/notification-routes";

export async function GET(req: NextRequest) {
  const authResult = await getAuthenticatedGuardian(req);
  if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await requireSchoolFeature(authResult.guardian.schoolId, "NOTIFICATIONS");
  if (denied) return denied;

  return handleUnreadCount(authResult.guardian.schoolId, { recipientType: "GUARDIAN", recipientId: authResult.guardian.id });
}
