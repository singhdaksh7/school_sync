import { NextResponse } from "next/server";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { listAttendanceReconciliationItems } from "@/lib/attendance-admin-correction";
import { requireSchoolFeature } from "@/lib/feature-flags";

/** Approved-leave-vs-submitted-attendance mismatches awaiting an admin decision — never auto-applied. */
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const actor = await resolveOperationsActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await requireSchoolAccessOrOperationalCapability(schoolId, actor.userId, actor.role, "ATTENDANCE", "VIEW", "ATTENDANCE_CORRECTION_VIEW");
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }

  const items = await listAttendanceReconciliationItems(schoolId);
  return NextResponse.json({ items });
}
