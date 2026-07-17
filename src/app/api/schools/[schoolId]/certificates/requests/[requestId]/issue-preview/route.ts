import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireCertificateAction } from "@/lib/certificates/authorization";
import { buildIssuancePreview } from "@/lib/certificates/issue";

/** Read-only preview of the exact snapshot/body that will be frozen if issuance is confirmed (spec §11). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ schoolId: string; requestId: string }> }) {
  const { schoolId, requestId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireCertificateAction(schoolId, session.user.id, "ISSUE");
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "CERTIFICATES");
  if (denied) return denied;

  const templateId = req.nextUrl.searchParams.get("templateId") ?? undefined;
  const result = await buildIssuancePreview(schoolId, requestId, templateId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ data: result.preview });
}
