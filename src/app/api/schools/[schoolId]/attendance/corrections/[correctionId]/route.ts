import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { reviewCorrectionRequest } from "@/lib/attendance-corrections";
import { requireSchoolFeature } from "@/lib/feature-flags";

const patchSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT"]),
    reviewNote: z.string().max(2000).optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; correctionId: string }> }) {
  const { schoolId, correctionId } = await params;
  const actor = await resolveOperationsActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { action, reviewNote } = patchSchema.parse(body);

    const capability = action === "APPROVE" ? "ATTENDANCE_CORRECTION_APPROVE" : "ATTENDANCE_CORRECTION_REJECT";
    const access = await requireSchoolAccessOrOperationalCapability(schoolId, actor.userId, actor.role, "ATTENDANCE", "APPROVE_CORRECTION", capability);
    if (!access.ok) return access.response;
    {
      const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
      if (denied) return denied;
    }

    const result = await reviewCorrectionRequest({
      correctionRequestId: correctionId,
      schoolId,
      action,
      reviewerUserId: actor.userId,
      reviewerRole: actor.role ?? null,
      reviewNote: reviewNote ?? null,
      actingTeacherId: access.teacherId,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (result.code === "SELF_APPROVAL_FORBIDDEN") {
        return NextResponse.json({ error: "Forbidden", reasonCode: "SELF_CORRECTION_APPROVAL_FORBIDDEN" }, { status: 403 });
      }
      // STATUS_CONFLICT
      return NextResponse.json(
        { error: "Attendance changed since this request was created", reasonCode: result.code, conflictingStudentIds: result.conflictingStudentIds },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, status: result.status, alreadyFinal: result.alreadyFinal });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Attendance correction review error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
