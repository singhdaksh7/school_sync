import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionReviewWrite } from "@/lib/admissions/authorization";
import { admissionSubmitSchema } from "@/lib/admissions/validation";
import { serializeApplicationDetail } from "@/lib/admissions/serializers";
import { assertLegalTransition, AdmissionTransitionError } from "@/lib/admissions/transitions";
import type { AdmissionApplicationStatusValue } from "@/lib/admissions/constants";

// "Admin" here means the two config-write roles — the only ones allowed to
// pass the explicit override flag (see spec: "an authorized admin passes an
// explicit override flag WITH a mandatory reason string").
const OVERRIDE_ROLES = new Set(["SCHOOL_OWNER", "SCHOOL_ADMIN"]);

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
    const data = admissionSubmitSchema.parse(await req.json().catch(() => ({})));

    if (data.override && !OVERRIDE_ROLES.has(access.actor.role)) {
      return NextResponse.json({ error: "Forbidden", reason: "OVERRIDE_REQUIRES_ADMIN" }, { status: 403 });
    }

    const application = await prisma.admissionApplication.findFirst({
      where: { id: applicationId, schoolId },
      include: { admissionCycle: true },
    });
    if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

    assertLegalTransition(application.status as AdmissionApplicationStatusValue, "SUBMITTED");

    // Required fields present before allowing SUBMITTED.
    if (!application.guardianName || !application.guardianPhone || !application.guardianRelation) {
      return NextResponse.json({ error: "Guardian details are required before submitting" }, { status: 400 });
    }

    const now = new Date();
    const withinWindow =
      application.admissionCycle.status === "OPEN" &&
      now >= application.admissionCycle.applicationStartAt &&
      now <= application.admissionCycle.applicationEndAt;

    if (!withinWindow && !data.override) {
      return NextResponse.json(
        { error: "Cycle is not open for applications, or the application window has closed", reasonCode: "CYCLE_CLOSED" },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const app = await tx.admissionApplication.update({
        where: { id: applicationId },
        data: {
          status: "SUBMITTED",
          submittedAt: now,
          version: { increment: 1 },
          ...(data.override
            ? { overriddenById: access.actor.userId, overrideReason: data.overrideReason }
            : {}),
        },
      });
      await tx.admissionStatusHistory.create({
        data: {
          applicationId,
          schoolId,
          previousStatus: application.status,
          newStatus: "SUBMITTED",
          reason: data.override ? `Window override: ${data.overrideReason}` : null,
          actorId: access.actor.userId,
        },
      });
      return app;
    });

    await logAudit({
      action: "ADMISSION_APPLICATION_SUBMITTED",
      entityType: "AdmissionApplication",
      entityId: applicationId,
      metadata: { override: Boolean(data.override) },
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
