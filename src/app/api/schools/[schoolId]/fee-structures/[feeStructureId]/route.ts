import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; feeStructureId: string }> }
) {
  const { schoolId, feeStructureId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "FEES");
    if (denied) return denied;
  }

  const structure = await prisma.feeStructure.findFirst({
    where: { id: feeStructureId, schoolId },
    select: { id: true, name: true, amount: true, frequency: true },
  });
  if (!structure) return NextResponse.json({ error: "Fee structure not found" }, { status: 404 });

  await prisma.feeStructure.delete({ where: { id: structure.id } });
  await logAudit({
    action: "FEE_STRUCTURE_DELETED",
    entityType: "FeeStructure",
    entityId: structure.id,
    metadata: {
      name: structure.name,
      frequency: structure.frequency,
    },
    userId: session.user.id,
    schoolId,
    actorRole: role,
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ success: true });
}
