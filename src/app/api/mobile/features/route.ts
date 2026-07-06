import { NextRequest, NextResponse } from "next/server";
import { getMobileAuth } from "@/lib/mobile-auth";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { getSchoolFeatureFlags } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

/**
 * Authenticated mobile feature-entitlement bootstrap (Phase 6 mobile
 * bootstrap contract closure — Blocker 1). A read-only view over the exact
 * same authoritative resolver every route-level requireSchoolFeature() check
 * already uses (getSchoolFeatureFlags) — this endpoint does not compute
 * availability differently, and never lets the caller choose a schoolId; the
 * tenant comes only from the authenticated bearer session (mobile JWT or
 * parent JWT), the same as /api/mobile/me.
 *
 * A feature being enabled here is NOT an authorization grant — Teacher
 * permissions (/api/teacher/permissions) and Parent/Student actor rules are
 * checked separately by each actual route and remain authoritative.
 */
export async function GET(req: NextRequest) {
  const mobile = await getMobileAuth(req);

  let schoolId: string;
  let actorType: string;
  let actorId: string;

  if (mobile) {
    schoolId = mobile.decoded.schoolId;
    actorType = mobile.decoded.role;
    actorId = mobile.decoded.studentId || mobile.decoded.teacherId || mobile.decoded.userId || "unknown";
  } else {
    const parent = await getAuthenticatedGuardian(req);
    if (!parent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    schoolId = parent.guardian.schoolId;
    actorType = "PARENT";
    actorId = parent.guardian.id;
  }

  const denied = await enforceActorRateLimit({ schoolId, actorType, actorId }, "STANDARD_READ");
  if (denied) return denied;

  const features = await getSchoolFeatureFlags(schoolId);
  return NextResponse.json({ features });
}
