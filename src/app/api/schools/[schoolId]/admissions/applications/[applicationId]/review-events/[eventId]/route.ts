import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole, teacherBelongsToSchool } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionReviewWrite, requireAssignedEvaluator } from "@/lib/admissions/authorization";
import { admissionReviewEventUpdateSchema, normalizeOptionalString } from "@/lib/admissions/validation";
import { serializeReviewEvent } from "@/lib/admissions/serializers";

type Params = { schoolId: string; applicationId: string; eventId: string };

// Fields a TEACHER may set on an event explicitly assigned to them — never
// reschedule/relocate/reassign, only record the outcome of an evaluation
// they were assigned to run.
const TEACHER_EDITABLE_FIELDS = new Set(["status", "score", "maxScore", "result", "notes"]);

export async function PATCH(req: Request, { params }: { params: Promise<Params> }) {
  const { schoolId, applicationId, eventId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Try the staff review-write path first; fall back to the narrow assigned-
  // evaluator (TEACHER) path. Neither path reveals existence to a caller who
  // fails both (404 either way).
  const staffAccess = await requireAdmissionReviewWrite(schoolId, session.user.id);
  let actorId: string;
  let isTeacherEvaluator = false;

  if (staffAccess.ok) {
    actorId = staffAccess.actor.userId;
  } else {
    const evaluatorAccess = await requireAssignedEvaluator(schoolId, session.user.id, eventId);
    if (!evaluatorAccess.ok) return evaluatorAccess.response;
    if (evaluatorAccess.applicationId !== applicationId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    actorId = evaluatorAccess.actor.userId;
    isTeacherEvaluator = true;
  }

  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    if (isTeacherEvaluator) {
      for (const key of Object.keys(body)) {
        if (!TEACHER_EDITABLE_FIELDS.has(key)) delete body[key];
      }
    }
    const data = admissionReviewEventUpdateSchema.parse(body);

    const existing = await prisma.admissionReviewEvent.findFirst({ where: { id: eventId, applicationId, schoolId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (data.evaluatorTeacherId && !(await teacherBelongsToSchool(data.evaluatorTeacherId, schoolId))) {
      return NextResponse.json({ error: "Evaluator teacher not found in this school" }, { status: 400 });
    }

    const event = await prisma.admissionReviewEvent.update({
      where: { id: eventId },
      data: {
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
        evaluatorTeacherId: data.evaluatorTeacherId === undefined ? undefined : data.evaluatorTeacherId,
        location: data.location !== undefined ? normalizeOptionalString(data.location) : undefined,
        instructions: data.instructions !== undefined ? normalizeOptionalString(data.instructions) : undefined,
        status: data.status,
        score: data.score,
        maxScore: data.maxScore,
        result: data.result !== undefined ? normalizeOptionalString(data.result) : undefined,
        notes: data.notes !== undefined ? normalizeOptionalString(data.notes) : undefined,
      },
    });

    await logAudit({
      action: "ADMISSION_REVIEW_EVENT_UPDATED",
      entityType: "AdmissionReviewEvent",
      entityId: eventId,
      metadata: { applicationId, status: data.status },
      userId: actorId,
      schoolId,
      actorRole: isTeacherEvaluator ? "TEACHER" : sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeReviewEvent(event, { includeInternal: true }));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
