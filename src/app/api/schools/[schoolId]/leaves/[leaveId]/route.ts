import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createArrangementsForLeave } from "@/lib/arrangements";
import { logAudit } from "@/lib/audit";
import { sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { buildDelegatedAuditMetadata } from "@/lib/operational-audit";

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; leaveId: string }> }
) {
  const { schoolId, leaveId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { status } = patchSchema.parse(body);

    // PART 15: approve and reject are the same underlying "LEAVE":"APPROVE"
    // mutation/permission at this route — the operational capability differs
    // (APPROVE vs REJECT) only for audit/API clarity, both resolve via the
    // same effective-head check.
    const capability = status === "APPROVED" ? "TEACHER_LEAVE_APPROVE" : "TEACHER_LEAVE_REJECT";
    const access = await requireSchoolAccessOrOperationalCapability(schoolId, session.user.id, sessionRole(session.user), "LEAVE", "APPROVE", capability);
    if (!access.ok) return access.response;

    // Fetch the leave request before updating so we have the details
    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: { id: leaveId, schoolId },
    });
    if (!leaveRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // PART 15/16: a teacher (direct-permission OR effective-head-delegated)
    // may never approve/reject their OWN leave. Checked here, server-side,
    // immediately before the mutation — never left to the client.
    if (access.teacherId && leaveRequest.teacherId === access.teacherId) {
      return NextResponse.json({ error: "Forbidden", reasonCode: "SELF_LEAVE_APPROVAL_FORBIDDEN" }, { status: 403 });
    }

    // Update status
    await prisma.leaveRequest.updateMany({
      where: { id: leaveId, schoolId },
      data: { status, reviewedById: session.user.id },
    });

    // If a TEACHER leave just got APPROVED, auto-create arrangements
    if (status === "APPROVED" && leaveRequest.type === "TEACHER" && leaveRequest.teacherId) {
      await createArrangementsForLeave(
        leaveId,
        leaveRequest.teacherId,
        schoolId,
        leaveRequest.fromDate,
        leaveRequest.toDate
      );
    }

    await logAudit({
      action: status === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      entityType: "LeaveRequest",
      entityId: leaveId,
      metadata: {
        type: leaveRequest.type,
        teacherId: leaveRequest.teacherId,
        ...(access.teacherId && access.operational ? { operational: buildDelegatedAuditMetadata(access.teacherId, access.operational) } : {}),
      },
      userId: session.user.id,
      schoolId,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; leaveId: string }> }
) {
  const { schoolId, leaveId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "LEAVE", "MANAGE");
  if (!access.ok) return access.response;

  await prisma.leaveRequest.deleteMany({ where: { id: leaveId, schoolId } });
  return NextResponse.json({ success: true });
}
