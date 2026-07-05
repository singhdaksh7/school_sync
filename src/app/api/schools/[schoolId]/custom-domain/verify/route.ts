import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { verifyDomainRequest } from "@/lib/custom-domain";

// Node runtime is required (node:dns) — this route must never declare
// `export const runtime = "edge"`.
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const denied = await requireSchoolFeature(schoolId, "WHITE_LABEL");
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const domainId = typeof body?.domainId === "string" ? body.domainId : "";
  if (!domainId) return NextResponse.json({ error: "domainId is required" }, { status: 400 });

  const result = await verifyDomainRequest(schoolId, domainId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    verified: result.verified,
    domain: {
      id: result.domain.id,
      hostname: result.domain.hostname,
      status: result.domain.status,
      lastCheckedAt: result.domain.lastCheckedAt,
      verifiedAt: result.domain.verifiedAt,
      failureReason: result.domain.failureReason,
    },
  });
}
