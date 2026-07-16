import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionRead } from "@/lib/admissions/authorization";
import { getAdmissionsDashboardSummary } from "@/lib/admissions/dashboard";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionRead(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  const summary = await getAdmissionsDashboardSummary(schoolId);
  return NextResponse.json(summary);
}
