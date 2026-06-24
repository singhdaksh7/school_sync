import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  sequence: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.examMilestone.findFirst({ where: { id, schoolId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = updateSchema.parse(await req.json());
    const updated = await prisma.examMilestone.update({
      where: { id },
      data: body,
    });
    await logAudit({
      action: existing.active && body.active === false ? "EXAM_MILESTONE_DISABLED" : "EXAM_MILESTONE_UPDATED",
      entityType: "ExamMilestone",
      entityId: updated.id,
      metadata: { name: updated.name, sequence: updated.sequence, active: updated.active },
      userId: session.user.id,
      schoolId,
      actorRole: role,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "An exam milestone with this name already exists" }, { status: 400 });
  }
}
