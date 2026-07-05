import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { schoolLifecycleGate } from "@/lib/school-access";
import { prisma } from "@/lib/prisma";
import { autoGenerateArrangementsForDate } from "@/lib/arrangements";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { canManageTeacherOperations } from "@/lib/operational-authorization";
import { buildDelegatedAuditMetadata } from "@/lib/operational-audit";

const bodySchema = z.object({
  date: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = sessionRole(session.user);
  let delegatedTeacherId: string | null = null;
  let delegatedOperational: Awaited<ReturnType<typeof canManageTeacherOperations>> | null = null;

  if (!(await canWriteSchool(schoolId, session.user.id, role))) {
    if (role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // PART 28: canWriteSchool above already lifecycle-gates the admin path,
    // but a SUSPENDED/EXPIRED school must also block the teacher-delegation
    // fallback — canManageTeacherOperations itself has no lifecycle awareness.
    const blocked = await schoolLifecycleGate(schoolId);
    if (blocked) return blocked;
    const teacher = await prisma.teacher.findFirst({ where: { userId: session.user.id, isDeleted: false }, select: { id: true, schoolId: true } });
    if (!teacher || teacher.schoolId !== schoolId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const operational = await canManageTeacherOperations({ schoolId, teacherId: teacher.id, capability: "ARRANGEMENTS_MANAGE" });
    if (!operational.allowed) return NextResponse.json({ error: "Forbidden", reasonCode: operational.reasonCode }, { status: 403 });
    delegatedTeacherId = teacher.id;
    delegatedOperational = operational;
  }

  try {
    // Body is optional — default to today when no date is supplied.
    const raw = await req.json().catch(() => ({}));
    const { date } = bodySchema.parse(raw ?? {});

    const target = date ? new Date(date) : new Date();
    if (Number.isNaN(target.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const result = await autoGenerateArrangementsForDate(schoolId, target);

    await logAudit({
      action: "ARRANGEMENTS_AUTO_GENERATED",
      entityType: "Arrangement",
      metadata: {
        ...(result as unknown as Record<string, unknown>),
        ...(delegatedTeacherId && delegatedOperational ? { operational: buildDelegatedAuditMetadata(delegatedTeacherId, delegatedOperational) } : {}),
      },
      userId: session.user.id,
      schoolId,
      actorRole: role,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
