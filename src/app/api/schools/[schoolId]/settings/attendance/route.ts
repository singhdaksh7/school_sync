import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { isValidCutoffTime, normalizeCutoffTime } from "@/lib/teacher-attendance";

const settingsSchema = z.object({
  teacherAttendanceCutoffTime: z.string().refine(isValidCutoffTime, "Cutoff time must be in HH:mm format"),
});

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { teacherAttendanceCutoffTime: true },
  });
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  return NextResponse.json({
    teacherAttendanceCutoffTime: normalizeCutoffTime(school.teacherAttendanceCutoffTime),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { teacherAttendanceCutoffTime } = settingsSchema.parse(body);
    const school = await prisma.school.update({
      where: { id: schoolId },
      data: { teacherAttendanceCutoffTime },
      select: { teacherAttendanceCutoffTime: true },
    });

    return NextResponse.json(school);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
