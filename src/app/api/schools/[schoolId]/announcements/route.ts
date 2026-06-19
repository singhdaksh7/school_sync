import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { logAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "ANNOUNCEMENTS", "VIEW");
  if (!access.ok) return access.response;

  const announcements = await prisma.announcement.findMany({
    where: { schoolId },
    include: { createdBy: { select: { name: true } } },
    orderBy: { publishedAt: "desc" },
  });
  return NextResponse.json(announcements);
}

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "ANNOUNCEMENTS", "CREATE");
  if (!access.ok) return access.response;

  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    const announcement = await prisma.announcement.create({
      data: { ...data, schoolId, createdById: session.user.id },
      include: { createdBy: { select: { name: true } } },
    });
    await logAudit({
      action: "ANNOUNCEMENT_CREATED",
      entityType: "Announcement",
      entityId: announcement.id,
      metadata: { title: announcement.title },
      userId: session.user.id,
      schoolId,
    });
    return NextResponse.json(announcement, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Create announcement error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
