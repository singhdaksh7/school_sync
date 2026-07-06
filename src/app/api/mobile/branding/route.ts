import { NextRequest, NextResponse } from "next/server";
import { getMobileAuth } from "@/lib/mobile-auth";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { resolveTenantBrandingForSchoolId } from "@/lib/school-resolver";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

/**
 * Authenticated mobile branding bootstrap (Phase 6 mobile bootstrap contract
 * closure — Blocker 2). GET /api/branding resolves by request hostname, which
 * cannot identify the school for a mobile client hitting one shared,
 * non-per-school-subdomain API host. This route derives the tenant only from
 * the authenticated bearer session (mobile JWT or parent JWT) — never a
 * client-supplied schoolId/host — and calls the same canonical
 * brandingForSchool/WHITE_LABEL resolver as the public route, just keyed by
 * schoolId instead of hostname. Works for every actor, including session
 * restore (/api/mobile/me callers) with no fresh credential login required.
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

  const branding = await resolveTenantBrandingForSchoolId(schoolId);
  return NextResponse.json(branding);
}
