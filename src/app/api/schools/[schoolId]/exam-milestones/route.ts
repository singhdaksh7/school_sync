import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { ensureDefaultExamMilestonesSeeded } from "@/lib/homework";
import { logAudit } from "@/lib/audit";

const milestoneSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = sessionRole(session.user);
  const userSchoolId = (session.user as { schoolId?: unknown }).schoolId;
  const isTeacherOfSchool = role === "TEACHER" && userSchoolId === schoolId;

  if (!isTeacherOfSchool && !(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ensureDefaultExamMilestonesSeeded(schoolId);
  const milestones = await prisma.examMilestone.findMany({
    where: { schoolId },
    orderBy: { sequence: "asc" },
  });
  return NextResponse.json(milestones);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = milestoneSchema.parse(await req.json());
    const maxSequence = await prisma.examMilestone.aggregate({ where: { schoolId }, _max: { sequence: true } });
    const milestone = await prisma.examMilestone.create({
      data: { schoolId, name: body.name, sequence: (maxSequence._max.sequence ?? -1) + 1 },
    });
    await logAudit({
      action: "EXAM_MILESTONE_CREATED",
      entityType: "ExamMilestone",
      entityId: milestone.id,
      metadata: { name: milestone.name },
      userId: session.user.id,
      schoolId,
      actorRole: role,
    });
    return NextResponse.json(milestone, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "An exam milestone with this name already exists" }, { status: 400 });
  }
}
