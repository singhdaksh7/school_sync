import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { schoolLifecycleGate } from "@/lib/school-access";
import { canManageTeacherOperations } from "@/lib/operational-authorization";
import { buildDelegatedAuditMetadata } from "@/lib/operational-audit";
import { assignArrangement } from "@/lib/arrangements";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

/** Owner/Admin (unchanged) OR the effective Operations Head (PART 18) for the given capability. */
async function canAccessOrOperationalCapability(
  schoolId: string,
  userId: string,
  role: string | undefined,
  capability: "ARRANGEMENTS_VIEW" | "ARRANGEMENTS_MANAGE"
): Promise<{ ok: true; teacherId: string | null; operational: Awaited<ReturnType<typeof canManageTeacherOperations>> | null } | { ok: false }> {
  // Lifecycle first (PART 28) — applies to BOTH the admin path and the
  // operational-delegation fallback; neither may bypass a SUSPENDED/EXPIRED school.
  if (await schoolLifecycleGate(schoolId)) return { ok: false };
  if (await canAccess(schoolId, userId)) return { ok: true, teacherId: null, operational: null };
  if (role !== "TEACHER") return { ok: false };

  const teacher = await prisma.teacher.findFirst({ where: { userId, isDeleted: false }, select: { id: true, schoolId: true } });
  if (!teacher || teacher.schoolId !== schoolId) return { ok: false };

  const operational = await canManageTeacherOperations({ schoolId, teacherId: teacher.id, capability });
  if (!operational.allowed) return { ok: false };
  return { ok: true, teacherId: teacher.id, operational };
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await canAccessOrOperationalCapability(schoolId, session.user.id, sessionRole(session.user), "ARRANGEMENTS_VIEW");
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const leaveRequestId = searchParams.get("leaveRequestId");
  const dateStr = searchParams.get("date");

  const arrangements = await prisma.arrangement.findMany({
    where: {
      schoolId,
      ...(leaveRequestId ? { leaveRequestId } : {}),
      ...(dateStr ? { date: new Date(dateStr) } : {}),
    },
    include: {
      absentTeacher: { select: { name: true, subject: true } },
      substituteTeacher: { select: { name: true, subject: true } },
      section: { include: { class: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }, { period: "asc" }],
  });
  return NextResponse.json(arrangements);
}

const assignSchema = z.object({
  date: z.string(),
  sectionId: z.string().min(1),
  period: z.number().int().positive(),
  subject: z.string().nullable().optional(),
  absentTeacherId: z.string().min(1),
  substituteTeacherId: z.string().nullable(),
});

/**
 * Manual single-lecture substitute assignment (PART 18/20) — resolves ONE
 * uncovered lecture (or changes an existing arrangement's substitute).
 * Reuses `assignArrangement` (arrangements.ts); does not reimplement ranking
 * or the bulk auto-generate sweep.
 */
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await canAccessOrOperationalCapability(schoolId, session.user.id, sessionRole(session.user), "ARRANGEMENTS_MANAGE");
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = assignSchema.parse(await req.json());
    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

    const result = await assignArrangement({
      schoolId,
      date,
      sectionId: body.sectionId,
      period: body.period,
      subject: body.subject ?? null,
      absentTeacherId: body.absentTeacherId,
      substituteTeacherId: body.substituteTeacherId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });

    await logAudit({
      action: "ARRANGEMENTS_AUTO_GENERATED",
      entityType: "Arrangement",
      entityId: result.arrangementId,
      metadata: {
        scope: "MANUAL_SINGLE_ASSIGNMENT",
        absentTeacherId: body.absentTeacherId,
        substituteTeacherId: body.substituteTeacherId,
        ...(access.teacherId && access.operational ? { operational: buildDelegatedAuditMetadata(access.teacherId, access.operational) } : {}),
      },
      userId: session.user.id,
      schoolId,
      actorRole: sessionRole(session.user),
    });

    return NextResponse.json({ success: true, arrangementId: result.arrangementId });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
