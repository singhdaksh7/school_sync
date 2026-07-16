import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { getClientIp } from "@/lib/request-ip";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionEnrollmentWrite } from "@/lib/admissions/authorization";
import { admissionEnrollSchema } from "@/lib/admissions/validation";
import { enrollApplication } from "@/lib/admissions/enrollment";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionEnrollmentWrite(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }
  {
    const limited = await rateLimit(`admissions:enroll:${schoolId}:${access.actor.userId}`, RATE_LIMIT_POLICIES.payment);
    if (!limited.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
    }
  }

  try {
    const data = admissionEnrollSchema.parse(await req.json());
    const outcome = await enrollApplication(schoolId, applicationId, access.actor.userId, data);

    if (!outcome.ok) {
      if (outcome.reason === "DUPLICATE_CANDIDATE") {
        // Never auto-merges — the caller must resend with confirmedDuplicate:
        // true to proceed anyway.
        return NextResponse.json(
          { error: "Possible duplicate student found — confirm to proceed", code: "DUPLICATE_CANDIDATE", candidates: outcome.candidates },
          { status: 409 }
        );
      }
      const statusByCode: Record<string, number> = {
        NOT_APPROVED: 400,
        ALREADY_CONVERTED: 409,
        SECTION_INVALID: 400,
        ROLL_NUMBER_TAKEN: 409,
      };
      return NextResponse.json({ error: outcome.error.message, code: outcome.error.code }, { status: statusByCode[outcome.error.code] ?? 400 });
    }

    await logAudit({
      action: "ADMISSION_APPLICATION_ENROLLED",
      entityType: "AdmissionApplication",
      entityId: applicationId,
      metadata: { studentId: outcome.result.student.id },
      userId: access.actor.userId,
      schoolId,
      actorRole: sessionRole(session.user),
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ student: outcome.result.student });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Enroll admission application error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
