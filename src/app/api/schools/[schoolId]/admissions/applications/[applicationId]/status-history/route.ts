import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireAdmissionRead } from "@/lib/admissions/authorization";
import { serializeStatusHistory } from "@/lib/admissions/serializers";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; applicationId: string }> }) {
  const { schoolId, applicationId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireAdmissionRead(schoolId, session.user.id);
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ADMISSIONS");
    if (denied) return denied;
  }

  const application = await prisma.admissionApplication.findFirst({ where: { id: applicationId, schoolId }, select: { id: true } });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const history = await prisma.admissionStatusHistory.findMany({ where: { applicationId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(history.map(serializeStatusHistory));
}
