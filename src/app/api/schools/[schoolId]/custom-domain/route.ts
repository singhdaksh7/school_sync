import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { createDomainRequest, disableDomain, getDomainForSchool, verificationRecordName, verificationRecordValue } from "@/lib/custom-domain";

function serialize(domain: Awaited<ReturnType<typeof getDomainForSchool>>) {
  if (!domain) return null;
  return {
    id: domain.id,
    hostname: domain.hostname,
    status: domain.status,
    verificationMethod: domain.verificationMethod,
    lastCheckedAt: domain.lastCheckedAt,
    verifiedAt: domain.verifiedAt,
    failureReason: domain.failureReason,
    createdAt: domain.createdAt,
    // DNS instructions — safe to return to the school's own admin (proves
    // nothing sensitive; the token only proves control of THEIR domain).
    dnsRecord:
      domain.status === "VERIFIED"
        ? null
        : { type: "TXT", name: verificationRecordName(domain.normalizedHostname), value: verificationRecordValue(domain.verificationToken) },
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "WHITE_LABEL");
    if (denied) return denied;
  }

  const domain = await getDomainForSchool(schoolId);
  return NextResponse.json({ domain: serialize(domain) });
}

// Custom-domain management is a WHITE_LABEL premium capability, gated the
// same way as the rest of branding, and follows the normal lifecycle policy
// (canWriteSchool → canAccessSchool denies SUSPENDED/EXPIRED schools) —
// deliberately NO billing-recovery exemption here (unlike payment-proof
// upload): a suspended school does not get to claim a new domain.
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "WHITE_LABEL");
    if (denied) return denied;
  }

  const body = await req.json().catch(() => ({}));
  const hostname = typeof body?.hostname === "string" ? body.hostname : "";
  if (!hostname) return NextResponse.json({ error: "hostname is required" }, { status: 400 });

  const result = await createDomainRequest(schoolId, hostname);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ domain: serialize(result.domain) }, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "WHITE_LABEL");
    if (denied) return denied;
  }

  const body = await req.json().catch(() => ({}));
  const domainId = typeof body?.domainId === "string" ? body.domainId : "";
  if (!domainId) return NextResponse.json({ error: "domainId is required" }, { status: 400 });

  const disabled = await disableDomain(schoolId, domainId);
  if (!disabled) return NextResponse.json({ error: "Domain not found or already disabled" }, { status: 404 });

  return NextResponse.json({ success: true });
}
