import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string; subjectId: string }> }) {
  const { schoolId, subjectId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = updateSchema.parse(body);

    const existing = await prisma.subject.findFirst({ where: { id: subjectId, schoolId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const subject = await prisma.subject.update({
      where: { id: subjectId },
      data: { name: data.name.trim() },
    });

    await logAudit({
      action: "SUBJECT_UPDATED",
      entityType: "Subject",
      entityId: subject.id,
      metadata: { name: subject.name },
      userId: session.user.id,
      schoolId,
    });

    return NextResponse.json(subject);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: "This subject already exists for this class/section" }, { status: 400 });
    console.error("Update subject error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ schoolId: string; subjectId: string }> }) {
  const { schoolId, subjectId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await prisma.subject.deleteMany({ where: { id: subjectId, schoolId } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await logAudit({
    action: "SUBJECT_DELETED",
    entityType: "Subject",
    entityId: subjectId,
    userId: session.user.id,
    schoolId,
  });

  return NextResponse.json({ success: true });
}
