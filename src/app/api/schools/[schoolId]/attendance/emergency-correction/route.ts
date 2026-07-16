import { NextResponse } from "next/server";
import { z } from "zod";
import { sectionBelongsToSchool } from "@/lib/tenant";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { applyAdminAttendanceCorrection } from "@/lib/attendance-admin-correction";
import { ATTENDANCE_STATUS_VALUES } from "@/lib/attendance-sessions";
import { requireSchoolFeature } from "@/lib/feature-flags";

// A teacher never gains this ability merely by having submitted attendance —
// it is authorized purely via requireSchoolAccessOrOperationalCapability
// ("ATTENDANCE_EMERGENCY_CORRECTION"), the same gate as every other
// admin/operational-actor mutation in this feature.
const schema = z
  .object({
    sectionId: z.string(),
    date: z.string(),
    reason: z.string().min(1, "A reason is required"),
    source: z.enum(["ADMIN_EMERGENCY", "LEAVE_RECONCILIATION"]).default("ADMIN_EMERGENCY"),
    items: z
      .array(
        z
          .object({
            studentId: z.string(),
            requestedStatus: z.enum(ATTENDANCE_STATUS_VALUES as [string, ...string[]]),
          })
          .strict()
      )
      .min(1, "At least one student is required"),
  })
  .strict();

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const actor = await resolveOperationsActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await requireSchoolAccessOrOperationalCapability(schoolId, actor.userId, actor.role, "ATTENDANCE", "APPROVE_CORRECTION", "ATTENDANCE_EMERGENCY_CORRECTION");
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    const parsed = schema.parse(body);

    if (!(await sectionBelongsToSchool(parsed.sectionId, schoolId))) {
      return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
    }

    const date = new Date(parsed.date + "T00:00:00.000Z");
    const result = await applyAdminAttendanceCorrection({
      schoolId,
      sectionId: parsed.sectionId,
      date,
      actorUserId: actor.userId,
      actorRole: actor.role ?? null,
      reason: parsed.reason,
      source: parsed.source,
      items: parsed.items.map((i) => ({ studentId: i.studentId, requestedStatus: i.requestedStatus as "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE" })),
    });

    if (!result.ok) return NextResponse.json({ error: "Emergency correction rejected", reasonCode: result.code }, { status: 400 });
    return NextResponse.json({ success: true, updatedCount: result.updatedCount });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Attendance emergency correction error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
