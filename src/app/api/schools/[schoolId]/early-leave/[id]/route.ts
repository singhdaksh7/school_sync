import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { createArrangementsForEarlyLeave } from "@/lib/arrangements";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { status } = patchSchema.parse(body);

    // Scope the lookup to this school so admins cannot touch another tenant's records.
    const request = await prisma.teacherEarlyLeaveRequest.findFirst({
      where: { id, schoolId },
    });
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Only a pending request can be reviewed. This blocks re-approval (which would
    // re-run generation) and blocks rejecting an already-approved request — which
    // would silently flip the status while leaving its arrangements in place.
    if (request.status !== "PENDING") {
      return NextResponse.json(
        {
          error: `This request has already been ${request.status.toLowerCase()}. Existing arrangements are unchanged.`,
        },
        { status: 409 }
      );
    }

    await prisma.teacherEarlyLeaveRequest.update({
      where: { id: request.id },
      data: { status, approvedById: session.user.id },
    });

    let generation = null;
    if (status === "APPROVED") {
      generation = await createArrangementsForEarlyLeave({
        schoolId,
        teacherId: request.teacherId,
        date: request.date,
        leaveAfterPeriod: request.leaveAfterPeriod,
      });
    }

    await logAudit({
      action: status === "APPROVED" ? "EARLY_LEAVE_APPROVED" : "EARLY_LEAVE_REJECTED",
      entityType: "TeacherEarlyLeaveRequest",
      entityId: request.id,
      metadata: { teacherId: request.teacherId, leaveAfterPeriod: request.leaveAfterPeriod, generation },
      userId: session.user.id,
      schoolId,
      actorRole: role,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true, generation });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
