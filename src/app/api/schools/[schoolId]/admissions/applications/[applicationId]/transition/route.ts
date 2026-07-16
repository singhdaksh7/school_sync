import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionReviewWrite } from "@/lib/admissions/authorization";
import { admissionTransitionSchema } from "@/lib/admissions/validation";
import { serializeApplicationDetail } from "@/lib/admissions/serializers";
import { assertLegalTransition, AdmissionTransitionError } from "@/lib/admissions/transitions";
import { DECISION_STATUSES } from "@/lib/admissions/constants";
import type { AdmissionApplicationStatusValue } from "@/lib/admissions/constants";

/**
 * Generic status transition endpoint for every non-submit, non-enrollment
 * move (UNDER_REVIEW, DOCUMENTS_PENDING, INTERVIEW_SCHEDULED,
 * ASSESSMENT_SCHEDULED, WAITLISTED, APPROVED, REJECTED, WITHDRAWN). SUBMITTED
 * has its own route (submit/route.ts, cycle-window aware); ENROLLED only
 * ever happens via enroll/route.ts's dedicated transaction.
 */
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionReviewWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  try {
    const data = admissionTransitionSchema.parse(await req.json());
    if (data.status === "SUBMITTED" || data.status === "ENROLLED") {
      return NextResponse.json({ error: `Use the dedicated ${data.status === "SUBMITTED" ? "submit" : "enroll"} endpoint for this transition` }, { status: 400 });
    }

    const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId } });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (application.version !== data.version) {
      return NextResponse.json({ error: "This application was modified by someone else — refresh and try again", code: "STALE_VERSION" }, { status: 409 });
    }

    assertLegalTransition(application.status as AdmissionApplicationStatusValue, data.status, data.reason);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.admissionApplication.updateMany({
        where: { id: applicationId, schoolId, version: data.version },
        data: {
          status: data.status,
          version: { increment: 1 },
          ...(DECISION_STATUSES.has(data.status) ? { decisionAt: new Date(), decidedById: access.actor.userId } : {}),
        },
      });
      if (result.count !== 1) throw new AdmissionTransitionError("ILLEGAL_TRANSITION", "Concurrent update detected");

      await tx.admissionStatusHistory.create({
        data: {
          applicationId,
          schoolId,
          previousStatus: application.status,
          newStatus: data.status,
          reason: data.reason ?? null,
          actorId: access.actor.userId,
        },
      });
      return tx.admissionApplication.findUniqueOrThrow({ where: { id: applicationId } });
    });

    await logAudit({
      action: "ADMISSION_APPLICATION_TRANSITIONED",
      entityType: "AdmissionApplication",
      entityId: applicationId,
      metadata: { from: application.status, to: data.status },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(serializeApplicationDetail(updated));
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (err instanceof AdmissionTransitionError) return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
