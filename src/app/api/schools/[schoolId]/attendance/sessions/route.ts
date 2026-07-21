import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sectionBelongsToSchool } from "@/lib/tenant";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";

/** Admin-facing view of attendance submission state (DRAFT/SUBMITTED) per section/date. */
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const actor = await resolveOperationsActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await requireSchoolAccessOrOperationalCapability(schoolId, actor.userId, actor.role, "ATTENDANCE", "VIEW", "ATTENDANCE_CORRECTION_VIEW");
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const sectionId = searchParams.get("sectionId");
  const status = searchParams.get("status") as "DRAFT" | "SUBMITTED" | null;

  if (sectionId && !(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
  }

  const sessions = await prisma.attendanceSession.findMany({
    where: {
      schoolId,
      ...(sectionId ? { sectionId } : {}),
      ...(date ? { date: new Date(date + "T00:00:00.000Z") } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      section: { select: { name: true, class: { select: { name: true } } } },
      submittedBy: { select: { name: true } },
    },
    orderBy: [{ date: "desc" }],
    take: 200,
  });

  return NextResponse.json(sessions);
}
