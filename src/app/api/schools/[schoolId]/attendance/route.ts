import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canAccessSchool, canWriteSchool, sectionBelongsToSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const typeParam = searchParams.get("type");
  const type = typeParam === "STUDENT" || typeParam === "TEACHER" ? typeParam : null;
  const sectionId = searchParams.get("sectionId");

  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });
  if (typeParam && !type) return NextResponse.json({ error: "Invalid attendance type" }, { status: 400 });
  if (sectionId && !(await sectionBelongsToSchool(sectionId, schoolId))) {
    return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
  }

  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  const records = await prisma.attendance.findMany({
    where: {
      schoolId,
      date: dateObj,
      ...(type ? { type } : {}),
      ...(sectionId ? { sectionId } : {}),
    },
    include: { student: true, teacher: true },
  });
  return NextResponse.json(records);
}

const markSchema = z.object({
  date: z.string(),
  type: z.enum(["STUDENT", "TEACHER"]),
  records: z.array(z.object({
    id: z.string(),
    status: z.enum(["PRESENT", "ABSENT", "LATE"]),
    sectionId: z.string().optional(),
  })),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const role = sessionRole(session.user);

  if (!(await canWriteSchool(schoolId, userId, role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: userId }, "MUTATION");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    const { type } = markSchema.parse(body);

    // Only class mentors (via teacher portal) can mark student attendance
    if (type === "STUDENT") {
      return NextResponse.json(
        { error: "Student attendance can only be marked by the class mentor via the teacher portal." },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Teacher attendance is marked by teachers themselves. Use auto-absent after the cutoff." },
      { status: 403 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
